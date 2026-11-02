"""Render sealed final inputs offline in hosted CI; never capture, synthesize voice or publish."""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
from fractions import Fraction
from final_contract import PLAN, WEB, require, sha, validate_directory, checked_render_command


def srt_from_ass(text, duration=165):
    def seconds(value):
        hours, minutes, rest = value.strip().split(':')
        return int(hours) * 3600 + int(minutes) * 60 + float(rest)
    def stamp(value):
        milliseconds = round(value * 1000)
        return f'{milliseconds // 3600000:02}:{milliseconds // 60000 % 60:02}:{milliseconds // 1000 % 60:02},{milliseconds % 1000:03}'
    cues = []
    for line in text.splitlines():
        if not line.startswith('Dialogue:'):
            continue
        parts = line.split(',', 9)
        require(len(parts) == 10, 'Invalid caption dialogue')
        start, end = seconds(parts[1]), seconds(parts[2])
        caption = re.sub(r'\{[^}]*\}', '', parts[9]).replace('\\N', '\n').replace('\\h', ' ')
        require(0 <= start < end <= duration and len(caption.splitlines()) <= 2 and all(len(x) <= 42 for x in caption.splitlines()), 'Caption bounds/wrapping failed')
        require(not cues or start >= cues[-1][1], 'Overlapping captions')
        cues.append((start, end, caption))
    require(cues, 'No measured captions')
    return '\n\n'.join(f'{i}\n{stamp(start)} --> {stamp(end)}\n{caption}' for i, (start, end, caption) in enumerate(cues, 1)) + '\n'


def render(project):
    require(os.environ.get('GITHUB_ACTIONS') == 'true', 'Hosted rendering only')
    temp = Path(os.environ['RUNNER_TEMP']).resolve()
    project = Path(project).resolve()
    require(project.is_relative_to(temp) and project != temp, 'CI temp project required')
    require(not any(k in os.environ for k in ['GH_TOKEN', 'GITHUB_TOKEN', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'ELEVENLABS_API_KEY']), 'Render worker must have no provider credentials')
    interfaces = {line.split(':', 1)[0].strip() for line in Path('/proc/net/dev').read_text().splitlines()[2:]}
    require(interfaces == {'lo'}, 'An isolated network namespace is required')
    manifest = validate_directory(project)
    require(shutil.disk_usage(project).free >= 2 * 1024**3, 'At least2GiB free required')
    out = project / 'out/final-render'
    out.mkdir(parents=True, exist_ok=False)
    receipt = {'status': 'running', 'mode': 'FINAL_RENDER_ONLY', 'sourcePlanSha256': PLAN, 'webRelease': WEB,
               'inputFiles': manifest['files'], 'networkInterfaces': sorted(interfaces), 'productRequests': 0,
               'captures': 0, 'voiceCalls': 0, 'publications': 0, 'humanWatchCompleted': False, 'commands': []}
    def save():
        (out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    def run(argv, name, expected=0, timeout=600):
        print('RUN ' + shlex.join(argv), flush=True)
        result = subprocess.run(argv, cwd=project, capture_output=True, text=True, encoding='utf-8', timeout=timeout)
        (out / (name + '.log')).write_text(result.stdout + '\n' + result.stderr, encoding='utf-8')
        receipt['commands'].append({'argv': argv, 'exit': result.returncode, 'log': name + '.log'})
        save()
        require(result.returncode == expected, 'Command failed: ' + name)
        return result
    def probe(file, name):
        result = run(['ffprobe', '-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', str(file)], name)
        return json.loads(result.stdout)
    try:
        save()
        for name in ['normalize_live.py', 'check_timing.py', 'make_captions.py', 'compose.py', 'contact_sheet.py', 'tts_elevenlabs.py']:
            run(['python', 'scripts/' + name, '--help'], 'help-' + name)
        run(['node', 'scripts/render_scene.mjs', '--help'], 'help-render_scene')
        run(['python', 'scripts/normalize_live.py', '--execute'], 'normalize-live', timeout=1500)
        run(['python', 'scripts/check_timing.py', '--narration', 'narration.json', '--timeline', 'timeline.json', '--measure', '--silences'], 'measured-timing', timeout=300)
        timing = json.loads((project / 'audio/timing.json').read_text(encoding='utf-8'))
        measured = timing['segments']
        require(set(measured) == {f'S{i}' for i in range(1, 10)} and all(s['fits_window'] is True for s in measured.values()), 'All nine measured audio segments must fit')
        voice = json.loads((project / 'evidence/voice-receipt.json').read_text(encoding='utf-8'))
        require(all(abs(measured[s['id']]['duration'] - s['durationSeconds']) <= .002 for s in voice['segments']), 'Measured master duration changed')
        run(['python', 'scripts/make_captions.py', '--narration', 'narration.json'], 'captions')
        (out / 'captions.srt').write_text(srt_from_ass((project / 'captions.ass').read_text(encoding='utf-8')), encoding='utf-8')
        timeline = json.loads((project / 'timeline.json').read_text(encoding='utf-8'))
        dry = run(['python', 'scripts/compose.py', '--timeline', 'timeline.json', '--strict', '--dry-run'], 'missing-renders-dry-run', expected=1)
        problems = re.findall(r'^\s*\d+\. (.+)$', dry.stderr, re.M)
        expected_problems = [f"{s['id']}: {s['file']} not rendered yet" for s in timeline['shots'] if s['kind'] == 'scene']
        expected_problems += [f"overlay {o['file']} not found; shown without it" for o in timeline['overlays']]
        require(sorted(problems) == sorted(expected_problems) and 'Traceback' not in dry.stderr and 'dry run: nothing encoded' in dry.stderr, 'Only unproduced renders may be missing')
        commands = [shlex.split(line.strip()) for line in dry.stderr.splitlines() if line.strip().startswith('node "')]
        outputs = {s['file'] for s in timeline['shots'] if s['kind'] == 'scene'} | {o['file'] for o in timeline['overlays']}
        require(len(commands) == len(outputs) == 18, 'Exact18 full-scale render commands required')
        seen = set()
        for number, command in enumerate(commands):
            checked_render_command(command, project, outputs, seen)
            seen.add(command[3])
            run(command, 'render-' + str(number + 1), timeout=1200)
            record_path = (project / command[3]).with_suffix('.json')
            record = json.loads(record_path.read_text(encoding='utf-8'))
            require(record['blocked_requests'] == 0, 'Rendered scene attempted network access')
        require(seen == outputs, 'Missing full-scale output')
        run(['python', 'scripts/compose.py', '--timeline', 'timeline.json', '--strict', '--dry-run'], 'strict-ready')
        negative = json.loads(json.dumps(timeline))
        negative['values']['S1_LINE1'] = '{{DELIBERATE_NEGATIVE_CONTROL}}'
        negative_path = project / 'negative-timeline.json'
        negative_path.write_text(json.dumps(negative), encoding='utf-8')
        refusal = run(['python', 'scripts/compose.py', '--timeline', 'negative-timeline.json', '--strict', '--dry-run'], 'negative-unresolved-token', expected=1)
        require('--strict refuses this build' in refusal.stderr and 'dry run: nothing encoded' in refusal.stderr and 'Traceback' not in refusal.stderr, 'Strict negative control did not fail safely')
        receipt['negativeControl'] = 'UNRESOLVED_TOKEN_REJECTED_BEFORE_ENCODING'
        final = out / 'standby-final.mp4'
        run(['python', 'scripts/compose.py', '--timeline', 'timeline.json', str(final), '--strict'], 'strict-compose', timeout=1800)
        media = probe(final, 'ffprobe-final')
        video = [s for s in media['streams'] if s['codec_type'] == 'video']
        audio = [s for s in media['streams'] if s['codec_type'] == 'audio']
        require(len(video) == len(audio) == 1 and len(media['streams']) == 2, 'Exactly one video/audio stream required')
        v, a = video[0], audio[0]
        require(v['codec_name'] == 'h264' and v['pix_fmt'] == 'yuv420p' and [v['width'], v['height']] == [1920, 1080] and Fraction(v['r_frame_rate']) == 25 and int(v['nb_read_frames']) == 4125, 'Final video technical contract')
        require(a['codec_name'] == 'aac' and a['sample_rate'] == '48000' and a['channels'] == 2, 'Final audio technical contract')
        require(abs(float(v['duration']) - 165) <= .04 and abs(float(a['duration']) - float(v['duration'])) <= .04, 'Final A/V duration mismatch')
        loud = run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(final), '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], 'loudness', timeout=300)
        integrated = re.findall(r'Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS', loud.stderr)
        peaks = re.findall(r'True peak:\s+Peak:\s+(-?[\d.]+) dBFS', loud.stderr)
        require(integrated and peaks and -17 <= float(integrated[-1]) <= -15 and float(peaks[-1]) <= -1.5, 'Final loudness/true-peak target failed')
        for name, args in [('blackdetect', ['-vf', 'blackdetect=d=0.2:pix_th=0.05', '-an']), ('freezedetect', ['-vf', 'freezedetect=n=-60dB:d=2', '-an']), ('silencedetect', ['-vn', '-af', 'silencedetect=noise=-45dB:d=1.5'])]:
            run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(final), *args, '-f', 'null', '-'], name, timeout=300)
        run(['python', 'scripts/contact_sheet.py', str(final), '--timeline', 'timeline.json', '--per-shot', '4', '--tile-width', '392', '--out', str(out / 'contact-sheet.jpg')], 'contact-sheet', timeout=300)
        run(['ffmpeg', '-v', 'error', '-ss', '9', '-i', str(project / 'rendered/S1.mp4'), '-an', '-frames:v', '1', '-q:v', '2', str(out / 'thumbnail.jpg')], 'thumbnail')
        receipt.update(status='TECHNICAL_PASS_REQUIRES_HUMAN_WATCH', finalSha256=sha(final.read_bytes()), finalBytes=final.stat().st_size,
                       videoFrames=int(v['nb_read_frames']), durationSeconds=float(v['duration']), integratedLufs=float(integrated[-1]), truePeakDbtp=float(peaks[-1]),
                       releaseEligible=False, manualChecks=['Inspect black/freeze/silence detector logs against planned holds', 'Inspect caption/label/callout contact sheets', 'Whole video on speakers and headphones'])
        save()
        print('PASS technical rendering; human visual/audio review still required. No publication.', flush=True)
    except Exception as error:
        receipt.update(status='fail', errorClass=type(error).__name__, error=str(error))
        save()
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    render(parser.parse_args().project)
