"""Pure validation for the sealed, render-only final video workspace."""
import hashlib
import json
import re
import stat
from pathlib import Path, PurePosixPath

PLAN = 'd614c7c6d09bf21d34972b44e69a8f9e927dc9f31e1ad0100617e0f158d4ae57'
WEB = 'db67b6d0a2455549736be0d6574c184309fe0277'
API = '3802d94e5ae5a66b6b7fb8fc67030393d0a276ea'
INDEX = 'a65500b133912bbfb94db319f976bfa8eebd0ebce82cb33a9427f2c865544423'
MODE = 'FINAL_VIDEO_RENDER_ONLY_NO_CAPTURE_OR_VOICE_CALLS'
ASSET = 'standby-pitch-final.zip'
MAX_ARCHIVE = 256 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024
LIVE = {'S2': 12, 'S4': 20, 'S5': 27, 'S6': 28, 'S7': 26}
SCENES = ['S1', 'S3', 'S8', 'S9']
QUALIFIED_SCENES = {
    'S1': '245a7029bb13dc1f32adc1cde6d85df0af5973c9a57394d99b6e918c5738e02a',
    'S3': 'c330329b1316bc427cfebd8de8e15ab7664f00824904a32f27b42d0d12092049',
    'S8': 'fe916f3472996298ebca4bc07666aed3b6b2ae118730015890c5a3f717c21fbf',
    'S9': '1e7c6c286ab138549c1eb4175048f5768cf77f827d4c5bc229d86003ba58ed85',
}
SCRIPTS = {
    'render_scene.mjs': '19ad3497e9e1427aeac27c5ba2a1228922be7baa42056edcfc7fafade95facbc',
    'check_timing.py': '765fe139a8cfc23fe0a40b0227a0750af187428b3694374de55594f68d3b702c',
    'make_captions.py': 'cfa0402c4691463dbd7ecc7e04e214ff7b875bcbd02393a4ccb75cbc9f8cdc1b',
    'compose.py': 'dd1d538a2780815413bf808d15e93c9b691a3f63c49c8890af5a32af34dc929b',
    'contact_sheet.py': 'c64545dee5eb70a604dda838fb2f79adae097f68d2a981fe294d49b117a3198b',
    'tts_elevenlabs.py': '11f2de640c807e6b096b7d01c12f88cc71fa80dd4b2dc1c3aa71506a6af144e1',
    'normalize_live.py': '68a8ccf1a75bb17ef2cf6d6f5bb554ed8e25c11b18960c863d74f2d6935f627d',
}
FILES = {
    'timeline.json', 'narration.json', 'captions.ass', 'plan-data.json',
    'final-production-approval.json', 'callouts.json', 'audio/timing.json',
    'evidence/clip-bindings.json', 'evidence/take4-proof.json',
    'evidence/take4-cuts.json', 'evidence/take5-proof.json', 'evidence/take5-cuts.json', 'evidence/voice-receipt.json',
} | {f'audio/S{i}.mp3' for i in range(1, 10)} | {
    f'live/source/{sid}.mp4' for sid in LIVE
} | {f'scenes/{sid}.html' for sid in [*SCENES, 'overlays', 'live-callouts']} | {
    'scripts/' + name for name in SCRIPTS
}


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe_name(name):
    p = PurePosixPath(name)
    return (isinstance(name, str) and not p.is_absolute() and '\\' not in name
            and all(re.fullmatch(r'[A-Za-z0-9_.-]+', s) and s not in ['.', '..'] for s in p.parts))


def member_limit(name):
    return 64 * 1024 * 1024 if name.endswith('.mp4') else 5 * 1024 * 1024 if name.endswith('.mp3') else 2 * 1024 * 1024


def validate_archive(archive):
    entries = archive.infolist()
    require(len(entries) == len(FILES) + 1 and {e.filename for e in entries} == FILES | {'manifest.json'}, 'Unexpected packet entries')
    require(len(set(e.filename for e in entries)) == len(entries), 'Duplicate packet entries')
    require(sum(e.file_size for e in entries) <= MAX_EXPANDED, 'Expanded packet too large')
    for e in entries:
        require(safe_name(e.filename) and not e.is_dir(), 'Unsafe packet path')
        require(stat.S_IFMT(e.external_attr >> 16) != stat.S_IFLNK, 'Packet symlink')
        require(0 < e.file_size <= member_limit(e.filename), 'Packet member size')
        require(e.compress_type in [0, 8], 'Unsupported ZIP compression')
    require(archive.testzip() is None, 'ZIP CRC failure')
    bodies = {e.filename: archive.read(e) for e in entries}
    validate_bodies(bodies)
    return bodies


def resolved(text, values):
    for key, value in values.items():
        text = text.replace('{{' + key + '}}', str(value))
    return text


def checked_render_command(command, project, outputs, seen):
    require(len(command) in [6, 7] and command[0] == 'node' and Path(command[1]).resolve() == (project / 'scripts/render_scene.mjs').resolve(), 'Unexpected render executable')
    require(re.fullmatch(r'scenes/(S1|S3|S8|S9|overlays|live-callouts)\.html\?.+', command[2]) and '{{' not in command[2], 'Unexpected scene query')
    require(command[3] in outputs and command[3] not in seen and command[4:6] == ['--fps', '25'], 'Unexpected render output/fps')
    require(command[6:] == (['--alpha'] if command[3].endswith('.mov') else []), 'No partial/scaled render permitted')
    return command


def validate_bodies(bodies):
    require(set(bodies) == FILES | {'manifest.json'}, 'Incomplete final workspace')
    manifest = json.loads(bodies['manifest.json'])
    require(manifest['mode'] == MODE and manifest['approvedPlanSha256'] == manifest['sourcePlanSha256'] == PLAN, 'Final mode/plan mismatch')
    require(manifest['webRelease'] == WEB and manifest['backendRelease'] == API, 'Frozen release mismatch')
    require(set(manifest['files']) == FILES, 'Final manifest file set')
    for name, record in manifest['files'].items():
        require(record['bytes'] == len(bodies[name]) and record['sha256'] == sha(bodies[name]), 'Sealed file changed: ' + name)
    for name, expected in SCRIPTS.items():
        require(sha(bodies['scripts/' + name]) == expected, 'Unreviewed executable: ' + name)
    for sid, expected in QUALIFIED_SCENES.items():
        require(sha(bodies['scenes/' + sid + '.html']) == expected, 'Qualified authored scene changed: ' + sid)
    require(sha(bodies['plan-data.json']) == PLAN, 'Original approved text plan changed')
    approval = json.loads(bodies['final-production-approval.json'])
    require(approval['status'] == 'OWNER_APPROVED_FINAL_RENDER' and approval['sourcePlanSha256'] == PLAN and approval['webRelease'] == WEB, 'Final production approval required')
    for flag in ['compositionApproved', 'syntheticVoiceApproved', 'reuseTake4ClipsApproved', 'minimumCleanTakesExceptionApproved']:
        require(approval.get(flag) is True, 'Specific owner approval required: ' + flag)
    plan = json.loads(bodies['plan-data.json'])
    timeline = json.loads(bodies['timeline.json'])
    narration = json.loads(bodies['narration.json'])
    voice = json.loads(bodies['evidence/voice-receipt.json'])
    require(sha(bodies['evidence/voice-receipt.json']) == '7c7dd48482732f198b6ab33cb62444aab4efeef28eb1a5f2519143c0b19696dc', 'Reviewed actual voice receipt changed')
    require(voice['provider']['service'] == 'Amazon Polly' and voice['provider']['voice'] == 'Matthew' and voice['provider']['engine'] == 'neural', 'Selected actual voice mismatch')
    require([s['id'] for s in voice['segments']] == [f'S{i}' for i in range(1, 10)], 'Nine actual master voice records required')
    for record, segment in zip(voice['segments'], narration['segments']):
        require(record['file'] == 'audio/' + segment['id'] + '.mp3' and record['audioSha256'] == sha(bodies[record['file']]) and record['bytes'] == len(bodies[record['file']]), 'Master audio bytes changed')
        require(record['speechSha256'] == sha(segment['speechText'].encode('utf-8')), 'Master speech text changed')
    require(timeline['source_plan_sha256'] == narration['source_plan_sha256'] == PLAN, 'Editorial source mismatch')
    require([timeline[k] for k in ['width', 'height', 'fps']] == [1920, 1080, 25], 'Final dimensions/fps')
    require(len(timeline['shots']) == len(narration['segments']) == len(plan['segments']) == 9, 'Nine original shots required')
    require([s['id'] for s in timeline['shots']] == [f'S{i}' for i in range(1, 10)], 'Shot order changed')
    for original, segment, shot in zip(plan['segments'], narration['segments'], timeline['shots']):
        require(original['id'] == segment['id'] == shot['id'], 'Segment identity mismatch')
        require(original['captionText'] == segment['captionText'] and original['speechText'] == segment['speechText'], 'Approved narration text changed')
        require(original['start'] == segment['window_start'] == shot['start'] and original['end'] == segment['window_end'] == shot['end'], 'Approved shot windows changed')
        require(segment.get('tts', True) is True, 'Every segment must use its approved master narration')
        if shot['id'] in LIVE:
            require(shot['kind'] == 'clip' and shot['clip_kind'] == 'live' and shot['file'] == 'live/' + shot['id'] + '.mp4', 'Unexpected live input')
            require(shot.get('source_session') == ('B' if shot['id'] == 'S7' else 'A'), 'Two-session source metadata missing')
            require(not shot.get('crop') and not shot.get('audio', {}).get('keep'), 'No live crop or retained sound')
            require(shot.get('in', 0) == 0 and shot.get('fit', 'contain') == 'contain', 'No live retiming or cover crop')
        else:
            require(shot['kind'] == 'scene' and shot['file'] == 'rendered/' + shot['id'] + '.mp4', 'Unexpected authored input')
    require(timeline['shots'][-1]['end'] == 165 and timeline.get('max_duration', 180) <= 179, 'Final duration contract')
    require(narration.get('audio_dir', 'audio') == 'audio', 'Canonical narration directory required')
    require(narration.get('timing', 'audio/timing.json') == 'audio/timing.json', 'Canonical timing path required')
    require(timeline.get('narration') == 'narration.json' and timeline.get('captions') == 'captions.ass', 'Canonical editorial paths required')
    require(len(timeline['overlays']) == 14 and len({o['file'] for o in timeline['overlays']}) == 14, 'Fourteen distinct approved overlays required')
    for overlay in timeline['overlays']:
        require(re.fullmatch(r'rendered/[A-Za-z0-9-]+\.mov', overlay['file']) and overlay['render'].startswith(('scenes/overlays.html?', 'scenes/live-callouts.html?')), 'Unexpected overlay source/output')
    bindings = json.loads(bodies['evidence/clip-bindings.json'])
    callouts = json.loads(bodies['callouts.json'])
    inline = re.search(r'<script\s+type="application/json"\s+id="callout-data">([\s\S]*?)</script>', bodies['scenes/live-callouts.html'].decode('utf-8'))
    require(inline and json.loads(inline.group(1)) == callouts, 'Inline callout data is stale')
    require(callouts['sourcePlanSha256'] == PLAN and callouts['webRelease'] == WEB and callouts['apiRelease'] == API, 'Callout source mismatch')
    require(callouts['sessionLabels'] == {'A': 'Capture A · 2 Nov 2026', 'B': 'Capture B · same release and seeded workload · 2 Nov 2026'}, 'Exact two-session badge labels required')
    require(callouts['sourceGeometry'] == [1536, 864] and callouts['productRectangle'] == [240, 90, 1440, 810] and callouts['sourceCrop'] is None and callouts['sourceSpeed'] == 1, 'Callout source geometry mismatch')
    require(bindings['sourcePlanSha256'] == PLAN and bindings['webRelease'] == WEB and bindings['apiRelease'] == API and set(bindings['sources']) == set(LIVE), 'Live source bindings mismatch')
    for sid, duration in LIVE.items():
        row = bindings['sources'][sid]
        require(row['status'] == 'BOUND_REVIEWED_SOURCE' and row['file'] == f'live/source/{sid}.mp4' and row['sha256'] == sha(bodies[row['file']]), 'Unqualified source clip: ' + sid)
        require(row['durationSeconds'] == duration and row['expectedFrames'] == duration * 25 and [row['width'], row['height'], row['fps']] == [1536, 864, 25], 'Source geometry/time mismatch')
        take = 5 if sid == 'S7' else 4
        require(row['session'] == ('B' if take == 5 else 'A') and row['take'] == f'TAKE_{take}', 'Source session mismatch')
        require(callouts['shots'][sid]['sourceSha256'] == row['sha256'] and callouts['shots'][sid]['session'] == row['session'], 'Stale callout source/session')
        require(row['proofFile'] == f'evidence/take{take}-proof.json' and row['proofSha256'] == sha(bodies[row['proofFile']]), 'Source proof mismatch')
        proof = json.loads(bodies[row['proofFile']])
        require(proof['take'] == row['take'] and proof['webRelease'] == WEB and proof['backendRelease'] == API, 'Proof release mismatch')
        require(any(s['id'] == sid and s['duration'] == duration for s in proof['shots']), 'Completed source window missing')
        if take == 4:
            require(row['proofSha256'] == '61bddb030de34e5adb93a954813ca5fa1ce10eb5034fc39cf9d2ed67f57fb063' and proof['status'] == 'fail', 'Original partial Take4 proof required')
        else:
            require(proof['status'] == 'pass' and proof['counts'] == {'applicationPostAttempts': 2, 'coverage': 1, 'capacity': 1, 'documents': 1}, 'Successful bounded Take5 proof required')
    return manifest


def validate_directory(project):
    bodies = {name: (project / name).read_bytes() for name in FILES | {'manifest.json'}}
    return validate_bodies(bodies)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', required=True)
    validated = validate_directory(Path(parser.parse_args().project).resolve())
    print('PASS sealed final inputs: ' + str(len(validated['files'])) + ' files; no scripts executed.')
