"""Download one sealed own-repository draft asset into a fresh CI temp directory."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import selectors
import stat
import subprocess
import time
import zipfile

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--asset-id',required=True)
parser.add_argument('--sha256',required=True)
parser.add_argument('--release',required=True)
parser.add_argument('--out',required=True)
parser.add_argument('--mode',choices=['scenes','take1','take2'],default='scenes')
args=parser.parse_args()
assert re.fullmatch(r'[1-9][0-9]{0,19}',args.asset_id)
assert re.fullmatch(r'[a-f0-9]{64}',args.sha256)
assert re.fullmatch(r'[a-f0-9]{40}',args.release)
assert os.environ.get('GITHUB_ACTIONS')=='true', 'Artifact download runs only in hosted CI'
out=Path(args.out).resolve()
temp=Path(os.environ['RUNNER_TEMP']).resolve()
assert out.is_relative_to(temp) and out!=temp and not out.exists()
endpoint='repos/upgradedev/standby/releases/assets/'+args.asset_id
meta=json.loads(subprocess.run(['gh','api',endpoint],capture_output=True,check=True,timeout=30).stdout)
assert str(meta['id'])==args.asset_id and meta['state']=='uploaded'
asset_name='standby-pitch-project.zip' if args.mode=='scenes' else 'standby-pitch-'+args.mode+'.zip'
assert meta['name']==asset_name and 0<meta['size']<=8*1024*1024
process=subprocess.Popen(['gh','api',endpoint,'-H','Accept: application/octet-stream'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
deadline=time.monotonic()+60
raw=bytearray()
try:
    # Hosted Ubuntu pipes are selectable. No blocking read can bypass the deadline.
    os.set_blocking(process.stdout.fileno(),False)
    with selectors.DefaultSelector() as selector:
        selector.register(process.stdout,selectors.EVENT_READ)
        ended=False
        while not ended:
            remaining=deadline-time.monotonic()
            if remaining<=0:
                raise TimeoutError('Asset download deadline exceeded')
            for key,_ in selector.select(min(remaining,1)):
                chunk=os.read(key.fileobj.fileno(),min(65536,8*1024*1024+1-len(raw)))
                if not chunk:
                    ended=True
                    break
                raw.extend(chunk)
                if len(raw)>8*1024*1024:
                    raise RuntimeError('Archive exceeds the bounded size')
        process.wait(timeout=max(0.01,deadline-time.monotonic()))
    assert process.returncode==0 and len(raw)==meta['size'], 'Asset download failed or length changed'
finally:
    if process.poll() is None:
        process.kill()
    process.wait(timeout=5)
    process.stdout.close()
raw=bytes(raw)
assert hashlib.sha256(raw).hexdigest()==args.sha256, 'Archive hash differs from the sealed input'
if args.mode=='scenes':
    allowed={'manifest.json','timeline.json','narration.json','scene-review.json'}
    allowed.update('scenes/'+name for name in ['S1.html','S3.html','S8.html','S9.html','overlays.html'])
    allowed.update('scripts/'+name for name in ['render_scene.mjs','contact_sheet.py','check_timing.py','compose.py','make_captions.py'])
else:
    take_number=1 if args.mode=='take1' else 2
    plan_name=f'take-{take_number}-plan.json'
    approval_name=f'take-{take_number}-owner-approval.json'
    allowed={'manifest.json',plan_name,approval_name,'web-manifest.json'}
    allowed.update('scripts/'+name for name in ['capture_app.mjs','take-driver.mjs','cut_clips.py','contact_sheet.py'])
with zipfile.ZipFile(io.BytesIO(raw)) as archive:
    entries=archive.infolist()
    assert len(entries)==len(allowed) and {entry.filename for entry in entries}==allowed
    assert len({entry.filename for entry in entries})==len(entries)
    assert sum(entry.file_size for entry in entries)<=16*1024*1024
    for entry in entries:
        name=PurePosixPath(entry.filename)
        assert not name.is_absolute() and all(re.fullmatch('[A-Za-z0-9_.-]+',part) and part not in ['.','..'] for part in name.parts)
        assert stat.S_IFMT(entry.external_attr>>16)!=stat.S_IFLNK
        assert not entry.is_dir() and entry.file_size<=2*1024*1024
        assert entry.compress_type in [zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED]
    assert archive.testzip() is None
    manifest=json.loads(archive.read('manifest.json'))
    expected_mode='SCENE_REVIEW_ONLY_NO_CAPTURE_OR_VOICE' if args.mode=='scenes' else f'OWNER_APPROVED_TAKE_{take_number}_NO_VOICE_OR_PUBLICATION'
    assert manifest['mode']==expected_mode
    assert manifest['webRelease']==args.release
    assert set(manifest['files'])==allowed-{'manifest.json'}
    bodies={name:archive.read(name) for name in allowed}
    for name,expected in manifest['files'].items():
        assert len(bodies[name])==expected['bytes'] and hashlib.sha256(bodies[name]).hexdigest()==expected['sha256']
    if args.mode=='scenes':
        timeline=json.loads(bodies['timeline.json'])
        narration=json.loads(bodies['narration.json'])
        review=json.loads(bodies['scene-review.json'])
        assert timeline['source_plan_sha256']==narration['source_plan_sha256']==review['source_plan_sha256']==manifest['approvedPlanSha256']
        assert review['source']['webRelease']==args.release and review['live_capture_allowed'] is False and review['network_allowed'] is False
    else:
        plan_hash=hashlib.sha256(bodies[plan_name]).hexdigest()
        expected_hash={1:'d64fe1efdbc7d5b8b56005c7dde2b8202da7c5bc4a12fa7ea19011dc9ca10edb',2:'3d49af61aa174e965bfa9e7aa2503be5100b94ec6c21e9ae5c52452ae5c5ec94'}[take_number]
        assert plan_hash==manifest['takePlanSha256']==expected_hash
        plan=json.loads(bodies[plan_name])
        approval=json.loads(bodies[approval_name])
        assert approval['status']==f'OWNER_APPROVED_SPECIFIC_TAKE_{take_number}' and approval['planSha256']==plan_hash
        assert approval['take']==plan['take']==f'TAKE_{take_number}' and approval['agentDrivenHostedCI'] is True
        assert approval['maximumAttempts']==plan['proposedExecution']['maximumAttempts']==1
        assert approval['maximumApplicationPostAttempts']==plan['hardLimits']['allApplicationPostAttempts']==3
        assert approval['maximumSeconds']==plan['proposedExecution']['maximumSeconds']==480
        assert approval['take2Approved' if take_number==1 else 'additionalTakeApproved'] is False
        assert approval['voiceApproved'] is False and approval['publicPublicationApproved'] is False
        assert plan['webRelease']==args.release and plan['sourcePlanSha256']==manifest['approvedPlanSha256']
    out.mkdir()
    for name,value in bodies.items():
        target=(out/name).resolve()
        assert target.is_relative_to(out)
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(value)
(out/'download-receipt.json').write_text(json.dumps({'assetId':args.asset_id,'archiveSha256':args.sha256,'webRelease':args.release,'approvedPlanSha256':manifest['approvedPlanSha256'],'files':len(allowed)-1,'mode':manifest['mode']},indent=2)+'\n',encoding='utf-8')
print('Verified and extracted sealed '+args.mode+' project: '+str(len(allowed)-1)+' files; no package script executed during acquisition.')
