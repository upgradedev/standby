"""Run a specifically approved anonymous take in hosted CI, after offline instrument checks."""
import argparse
from datetime import datetime, timezone
import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project', required=True)
parser.add_argument('--instrument-only', action='store_true')
parser.add_argument('--take', choices=['1', '2', '3', '4'], default='1')
args = parser.parse_args()
assert os.environ.get('GITHUB_ACTIONS') == 'true', 'Hosted CI only'
project = Path(args.project).resolve()
temp = Path(os.environ['RUNNER_TEMP']).resolve()
assert project.is_relative_to(temp) and project != temp
take_number = int(args.take)
out = project / 'out' / ('take' + args.take)
out.mkdir(parents=True, exist_ok=True)
receipt = {'status': 'running', 'scope': f'SPECIFIC_OWNER_APPROVED_TAKE_{take_number}',
           'productTakeStarted': False, 'productTakes': 0, 'voiceCalls': 0,
           'paidRouteBuilds': 0, 'publicPublications': 0, 'instrument': []}


def save():
    (out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def run(command, *, timeout=60, log=None, expected=0, env=None):
    result = subprocess.run(command, cwd=project, env=env, capture_output=True,
                            text=True, encoding='utf-8', timeout=timeout)
    if log:
        log.write_text(result.stdout + '\n' + result.stderr, encoding='utf-8')
    assert result.returncode == expected, 'Instrument subprocess returned unexpected status: ' + Path(command[1]).name
    return result


def probe(file):
    return json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(file)]).stdout)


def get(url, limit=4 * 1024 * 1024):
    parsed = urllib.parse.urlsplit(url)
    assert parsed.scheme == 'https' and parsed.netloc == 'd34x1513u5u1qs.cloudfront.net'
    with urllib.request.urlopen(urllib.request.Request(url, headers={'Cache-Control': 'no-cache'}), timeout=30) as response:
        assert response.status == 200 and response.url == url, 'Public source changed or unavailable'
        body = response.read(limit + 1)
    assert len(body) <= limit
    return body


def instrument():
    """Exercise the real copied recorder and cutter without opening the product."""
    fixture = out / 'instrument'
    fixture.mkdir(exist_ok=False)
    (fixture / 'index.html').write_text('<!doctype html><title>Offline recorder instrument fixture</title><h1>Offline recorder instrument fixture</h1>', encoding='utf-8')
    (fixture / 'driver.mjs').write_text(
        "export default async({page,url,mark})=>{await page.goto(url);await page.getByRole('heading',{name:'Offline recorder instrument fixture',exact:true}).waitFor();mark('fixture_ready');await new Promise(r=>setTimeout(r,1600));};\n", encoding='utf-8')
    (fixture / 'reject.mjs').write_text(
        "export default async({page,url,mark})=>{await page.goto(url);mark('fixture_expected_rejection');throw new Error('fixture-deliberate-rejection');};\n", encoding='utf-8')

    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *unused):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(fixture)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        for name, expected in [('driver', 0), ('reject', 1)]:
            folder = fixture / name
            profile = fixture / (name + '-profile')
            command = ['node', 'scripts/capture_app.mjs', 'record', '--url',
                       'http://127.0.0.1:' + str(server.server_port) + '/', '--driver', str(fixture / (name + '.mjs')),
                       '--headless', '--size', '1536x864', '--max-seconds', '8', '--out', str(folder), '--profile', str(profile)]
            try:
                result = run(command, timeout=45, log=fixture / (name + '.log'), expected=expected)
                records = list(folder.glob('marks_*.json'))
                assert len(records) == 1
                marks = json.loads(records[0].read_text(encoding='utf-8'))
                assert any(mark['name'] == ('fixture_ready' if name == 'driver' else 'fixture_expected_rejection') for mark in marks['marks'])
                assert any(mark['name'] == 'stop' for mark in marks['marks'])
                if name == 'reject':
                    assert marks['summary']['failure'] == 'fixture-deliberate-rejection'
                    assert any(mark['name'] == 'driver_failed' and mark.get('code') == 'fixture-deliberate-rejection' for mark in marks['marks'])
                else:
                    assert marks['summary']['failure'] is None and marks['summary']['stopped_by'] == 'driver complete'
                videos = list((folder / 'video').glob('*.webm'))
                assert len(videos) == 1 and videos[0].stat().st_size > 0
                media = probe(videos[0])
                stream = next(stream for stream in media['streams'] if stream['codec_type'] == 'video')
                assert [stream['width'], stream['height']] == [1536, 864]
                if name == 'driver':
                    assert float(media['format']['duration']) >= 1.5
                    cuts = {'source': str(videos[0]), 'marks': str(records[0]), 'fps': 25,
                            'out_dir': 'cuts', 'keep_audio': False, 'clips': {'fixture': [[0.24, 1.24]]}}
                    cut_file = folder / 'cuts.json'
                    cut_file.write_text(json.dumps(cuts, indent=2) + '\n', encoding='utf-8')
                    run(['python', 'scripts/cut_clips.py', str(cut_file), '--dry-run'])
                    run(['python', 'scripts/cut_clips.py', str(cut_file)], log=fixture / 'cut.log')
                    final = probe(folder / 'cuts' / 'fixture.mp4')
                    assert abs(float(final['format']['duration']) - 1) < 0.041
                    assert next(s for s in final['streams'] if s['codec_type'] == 'video')['r_frame_rate'] == '25/1'
                receipt['instrument'].append({'name': name, 'exit': result.returncode,
                                              'marksAndVideo': 'pass', 'status': 'pass'})
                save()
            finally:
                run(['node', 'scripts/capture_app.mjs', 'cleanup', '--profile', str(profile)])
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    if take_number == 4:
        # Exercise the exact source-qualified helper and recorder without product access.
        source = Path(__file__).resolve().parent
        assert (project / 'scripts/capture-state.mjs').read_bytes() == (source / 'capture-state.mjs').read_bytes()
        assert (project / 'scripts/capture_app.mjs').read_bytes() == (source / 'fixtures/capture_app.mjs').read_bytes()
        run(['node', str(source / 'check-capture-paint.mjs'), '--help'])
        run(['node', str(source / 'check-capture-paint.mjs'), '--out', str(fixture / 'paint')],
            timeout=100, log=fixture / 'paint.log')
        pixels = json.loads((fixture / 'paint/receipt.json').read_text(encoding='utf-8'))
        assert pixels['status'] == 'pass' and pixels['applicationRequests'] == pixels['productTakes'] == 0
        receipt['instrument'].append({'name': 'decoded-idle-run-paint', 'status': 'pass',
                                      'longestGreenRun': pixels['decoded']['longestGreenRun']})
        save()


try:
    manifest = json.loads((project / 'manifest.json').read_text(encoding='utf-8'))
    assert manifest['mode'] == f'OWNER_APPROVED_TAKE_{take_number}_NO_VOICE_OR_PUBLICATION'
    for name, record in manifest['files'].items():
        assert sha((project / name).read_bytes()) == record['sha256'], 'Verified input changed after transfer'
    plan_file = project / f'take-{take_number}-plan.json'
    plan_bytes = plan_file.read_bytes()
    plan = json.loads(plan_bytes)
    approval = json.loads((project / f'take-{take_number}-owner-approval.json').read_text(encoding='utf-8'))
    expected_hash = {1: 'd64fe1efdbc7d5b8b56005c7dde2b8202da7c5bc4a12fa7ea19011dc9ca10edb',
                     2: '3d49af61aa174e965bfa9e7aa2503be5100b94ec6c21e9ae5c52452ae5c5ec94', 3: '33cfeb5de8e53bf723f78015db9f12742aa09e9c00bc354eb2603cd621182afd', 4: '6f31311de3e55896ae97d6d0da5d7a84176ec189416535632b4f56e534258876'}[take_number]
    assert sha(plan_bytes) == approval['planSha256'] == expected_hash
    assert approval['status'] == f'OWNER_APPROVED_SPECIFIC_TAKE_{take_number}'
    assert approval['take'] == plan['take'] == f'TAKE_{take_number}'
    assert approval['maximumAttempts'] == 1 and approval['maximumApplicationPostAttempts'] == 3
    assert approval['agentDrivenHostedCI'] is True and approval['voiceApproved'] is False
    assert approval['publicPublicationApproved'] is False and approval['maximumSeconds'] == 480
    assert approval['take2Approved' if take_number == 1 else 'additionalTakeApproved'] is False
    receipt['planSha256'] = sha(plan_bytes)
    receipt['webRelease'] = plan['webRelease']
    receipt['backendRelease'] = plan['backendRelease']
    for command in [['node', 'scripts/capture_app.mjs', '--help'],
                    ['node', 'scripts/take-driver.mjs', '--help'],
                    ['python', 'scripts/cut_clips.py', '--help'],
                    ['python', 'scripts/contact_sheet.py', '--help']]:
        run(command)
    instrument()
    assert len(receipt['instrument']) == (3 if take_number == 4 else 2)
    if args.instrument_only:
        receipt['status'] = 'INSTRUMENT_PASSED_NO_PRODUCT_TAKE'
        save()
        print('PASS offline recorder, deliberate driver failure, marks, video and frame-grid cutter. No product request.')
        raise SystemExit(0)

    assert os.environ.get('GITHUB_RUN_ATTEMPT') == '1', 'No take rerun is authorized'
    base = 'https://d34x1513u5u1qs.cloudfront.net'
    web = json.loads((project / 'web-manifest.json').read_text(encoding='utf-8'))
    assert web['webRelease'] == plan['webRelease'] and len(web['files']) == 22
    keys = {file['key'] for file in web['files']}
    assert len(keys) == 22 and {'index.html', 'theme.js', 'standby.svg'}.issubset(keys)
    assert sha(get(base + '/capacity')) == plan['indexSha256']
    checked = []
    for file in web['files']:
        assert re.fullmatch(r'(?:assets/[A-Za-z0-9_.-]+|index.html|theme.js|standby.svg)', file['key']), 'Unexpected public asset'
        assert sha(get(base + '/' + file['key'])) == file['sha256'], 'Frozen served asset changed'
        checked.append(file['key'])
    config = json.loads(get(base + '/config.json'))
    api = urllib.parse.urljoin(base, config['apiBase'])
    assert api == base + '/api/v1'
    health = json.loads(get(api + '/health'))
    metadata = json.loads(get(api + '/public/manifest'))
    zones = json.loads(get(api + '/public/zones'))['zones']
    assert config['release'] == health['release'] == metadata['release'] == plan['backendRelease']
    assert health['status'] == 'ready' and metadata['matrix']['profile'] == 'Car'
    assert datetime.fromisoformat(metadata['matrix']['expiresAt'].replace('Z', '+00:00')) > datetime.now(timezone.utc)
    assert len(zones) == metadata['limits']['zoneCount']
    for cohort in ['train', 'holdout']:
        assert sum(zone[cohort + 'Count'] for zone in zones) == metadata['dataset']['quality']['accepted'][cohort]
    receipt['preflight'] = {'status': 'pass', 'servedFiles': len(checked),
                            'datasetHash': metadata['dataset']['hash'], 'matrixHash': metadata['matrix']['hash'],
                            'observedAt': datetime.now(timezone.utc).isoformat()}
    # The exclusive marker is written before invoking the actual recorder.
    with (project / f'take{take_number}-started.json').open('x', encoding='utf-8') as marker:
        json.dump({'runId': os.environ['GITHUB_RUN_ID'], 'planSha256': receipt['planSha256']}, marker)
    receipt['productTakeStarted'] = True
    receipt['productTakes'] = 1
    save()
    profile = project / f'take{take_number}-profile'
    env = dict(os.environ, STANDBY_TAKE_PLAN=str(plan_file))
    try:
        run(['node', 'scripts/capture_app.mjs', 'record', '--url', base + '/map', '--driver',
             str(project / 'scripts/take-driver.mjs'), '--headless', '--size', '1536x864',
             '--max-seconds', '480', '--out', str(out), '--profile', str(profile)],
            timeout=510, env=env, log=out / 'capture.log')
    finally:
        run(['node', 'scripts/capture_app.mjs', 'cleanup', '--profile', str(profile)])
    proof = json.loads((out / 'take-proof.json').read_text(encoding='utf-8'))
    assert proof['status'] == 'pass'
    shots = proof['shots']
    assert [shot['id'] for shot in shots] == ['S2', 'S4', 'S5', 'S6', 'S7']
    windows = dict(zip(['S2', 'S4', 'S5', 'S6', 'S7'], [12, 20, 27, 28, 26]))
    videos = list((out / 'video').glob('*.webm'))
    marks = list(out.glob('marks_*.json'))
    assert len(videos) == len(marks) == 1
    raw_duration = float(probe(videos[0])['format']['duration'])
    for shot in shots:
        assert abs(shot['end'] - shot['start'] - windows[shot['id']]) < 1e-6
        assert shot['start'] >= 0 and shot['end'] <= raw_duration
        assert abs(shot['start'] * 25 - round(shot['start'] * 25)) < 1e-6
    cuts = {'source': str(videos[0]), 'marks': str(marks[0]), 'fps': 25, 'crf': 16,
            'out_dir': 'clips', 'keep_audio': False,
            'clips': {shot['id']: [[shot['start'], shot['end']]] for shot in shots}}
    cuts_file = out / 'cuts.json'
    cuts_file.write_text(json.dumps(cuts, indent=2) + '\n', encoding='utf-8')
    run(['python', 'scripts/cut_clips.py', str(cuts_file), '--dry-run'], log=out / 'cuts-dry-run.log')
    run(['python', 'scripts/cut_clips.py', str(cuts_file)], timeout=240, log=out / 'cuts.log')
    receipt['clips'] = []
    for id, duration in windows.items():
        file = out / 'clips' / (id + '.mp4')
        info = probe(file)
        stream = next(s for s in info['streams'] if s['codec_type'] == 'video')
        assert stream['r_frame_rate'] == '25/1' and [stream['width'], stream['height']] == [1536, 864]
        assert not any(s['codec_type'] == 'audio' for s in info['streams'])
        assert abs(float(info['format']['duration']) - duration) < 0.041
        run(['python', 'scripts/contact_sheet.py', str(file), '--every', '1', '--out',
             str(out / (id + '-contact.jpg')), '--tile-width', '392'], timeout=60)
        receipt['clips'].append({'id': id, 'duration': duration, 'sha256': sha(file.read_bytes())})
    receipt['status'] = f'TAKE_{take_number}_CAPTURED_REQUIRES_VISUAL_REVIEW'
    receipt['rawVideoSha256'] = sha(videos[0].read_bytes())
    save()
    print(f'PASS Take{take_number} captured and cut on frame grid. Visual review required; no additional take or voice authorized.')
except Exception as error:
    receipt['status'] = 'fail'
    receipt['errorClass'] = type(error).__name__
    # No response payload, configuration, secret or provider URL is printed.
    save()
    raise
