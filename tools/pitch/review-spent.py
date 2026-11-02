"""Cut verified completed windows from a pinned already-spent artifact. No browser or network."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--project', required=True)
parser.add_argument('--capture', required=True)
parser.add_argument('--out', required=True)
parser.add_argument('--take', choices=['1', '4'], default='1')
args = parser.parse_args()
assert os.environ.get('GITHUB_ACTIONS') == 'true'
temp = Path(os.environ['RUNNER_TEMP']).resolve()
project, capture, out = [Path(value).resolve() for value in [args.project, args.capture, args.out]]
assert all(value.is_relative_to(temp) and value != temp for value in [project, capture, out])
assert not out.exists()
out.mkdir(parents=True)
proof_bytes = (capture / 'take-proof.json').read_bytes()
proof = json.loads(proof_bytes)
assert proof['take'] == 'TAKE_' + args.take and proof['status'] == 'fail'
if args.take == '1':
    assert proof['planSha256'] == 'd64fe1efdbc7d5b8b56005c7dde2b8202da7c5bc4a12fa7ea19011dc9ca10edb'
    assert proof['failure']['code'] == 'shot-actions-exceed-clean-window'
    expected_shots = ['S2', 'S4']
    source_run = '41228706765'
    missing = ['S5', 'S6', 'S7']
else:
    assert hashlib.sha256(proof_bytes).hexdigest() == '61bddb030de34e5adb93a954813ca5fa1ce10eb5034fc39cf9d2ed67f57fb063'
    assert proof['planSha256'] == '6f31311de3e55896ae97d6d0da5d7a84176ec189416535632b4f56e534258876'
    assert proof['failure']['stage'] == 'S7-candidate-edit-prepare' and proof['failure']['timedOut'] is True
    expected_shots = ['S2', 'S4', 'S5', 'S6']
    source_run = '41421976953'
    missing = ['S7']
assert proof['counts']['applicationPostAttempts'] == 2
assert [shot['id'] for shot in proof['shots']] == expected_shots
videos = list((capture / 'video').glob('capture_*.webm'))
marks = list(capture.glob('marks_*.json'))
assert len(videos) == len(marks) == 1
if args.take == '4':
    assert hashlib.sha256(videos[0].read_bytes()).hexdigest() == '693a065cfd4ab62270d71eb1fca920fdf3032c17feb81b666586a316c25e8825'


def run(command):
    result = subprocess.run(command, cwd=project, capture_output=True, text=True, timeout=180)
    assert result.returncode == 0, 'Spent media review tool failed'
    return result.stdout


for script in ['cut_clips.py', 'contact_sheet.py']:
    run(['python', 'scripts/' + script, '--help'])
cuts = {'source': str(videos[0]), 'marks': str(marks[0]), 'fps': 25, 'crf': 16,
        'out_dir': 'clips', 'keep_audio': False,
        'clips': {shot['id']: [[shot['start'], shot['end']]] for shot in proof['shots']}}
file = out / 'cuts.json'
file.write_text(json.dumps(cuts, indent=2) + '\n', encoding='utf-8')
(out / 'dry-run.log').write_text(run(['python', 'scripts/cut_clips.py', str(file), '--dry-run']), encoding='utf-8')
(out / 'cuts.log').write_text(run(['python', 'scripts/cut_clips.py', str(file)]), encoding='utf-8')
for shot in proof['shots']:
    run(['python', 'scripts/contact_sheet.py', str(out / 'clips' / (shot['id'] + '.mp4')),
         '--every', '1', '--out', str(out / (shot['id'] + '-contact.jpg')), '--tile-width', '392'])
if args.take == '1':
    run(['python', 'scripts/contact_sheet.py', str(videos[0]), '--at', '54.44,60,70,80,90,100',
         '--out', str(out / 'transport-diagnostic.jpg')])
receipt = {'status': 'PARTIAL_SOURCE_WINDOWS_ONLY_NOT_A_CLEAN_TAKE',
           'sourceRun': 'https://github.com/upgradedev/standby/actions/runs/' + source_run,
           'rawVideoSha256': hashlib.sha256(videos[0].read_bytes()).hexdigest(),
           'completedShots': expected_shots, 'missingShots': missing,
           'newProductRequests': 0, 'newProductTakes': 0, 'releaseEligible': False}
(out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
print('PASS spent artifact review only: verified completed windows; failure preserved. No new product request.')
