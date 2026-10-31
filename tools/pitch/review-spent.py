"""Cut only completed windows from an already-spent Take1 artifact. No browser or network."""
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
args = parser.parse_args()
assert os.environ.get('GITHUB_ACTIONS') == 'true'
temp = Path(os.environ['RUNNER_TEMP']).resolve()
project, capture, out = [Path(value).resolve() for value in [args.project, args.capture, args.out]]
assert all(value.is_relative_to(temp) and value != temp for value in [project, capture, out])
assert not out.exists()
out.mkdir(parents=True)
proof = json.loads((capture / 'take-proof.json').read_text(encoding='utf-8'))
assert proof['take'] == 'TAKE_1' and proof['status'] == 'fail'
assert proof['planSha256'] == 'd64fe1efdbc7d5b8b56005c7dde2b8202da7c5bc4a12fa7ea19011dc9ca10edb'
assert proof['failure']['code'] == 'shot-actions-exceed-clean-window'
assert proof['counts']['applicationPostAttempts'] == 2
assert [shot['id'] for shot in proof['shots']] == ['S2', 'S4']
videos = list((capture / 'video').glob('capture_*.webm'))
marks = list(capture.glob('marks_*.json'))
assert len(videos) == len(marks) == 1


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
run(['python', 'scripts/contact_sheet.py', str(videos[0]), '--at', '54.44,60,70,80,90,100',
     '--out', str(out / 'transport-diagnostic.jpg')])
receipt = {'status': 'PARTIAL_SOURCE_WINDOWS_ONLY_NOT_A_CLEAN_TAKE',
           'sourceRun': 'https://github.com/upgradedev/standby/actions/runs/41228706765',
           'rawVideoSha256': hashlib.sha256(videos[0].read_bytes()).hexdigest(),
           'completedShots': ['S2', 'S4'], 'failedShot': 'S5', 'missingShots': ['S6', 'S7'],
           'newProductRequests': 0, 'newProductTakes': 0, 'releaseEligible': False}
(out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
print('PASS spent artifact review only: two completed windows; failure preserved. No new product request.')
