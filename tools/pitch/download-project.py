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
assert meta['name']=='standby-pitch-project.zip' and 0<meta['size']<=8*1024*1024
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
allowed={'manifest.json','timeline.json','narration.json','scene-review.json'}
allowed.update('scenes/'+name for name in ['S1.html','S3.html','S8.html','S9.html','overlays.html'])
allowed.update('scripts/'+name for name in ['render_scene.mjs','contact_sheet.py','check_timing.py','compose.py','make_captions.py'])
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
    assert manifest['mode']=='SCENE_REVIEW_ONLY_NO_CAPTURE_OR_VOICE'
    assert manifest['webRelease']==args.release
    assert set(manifest['files'])==allowed-{'manifest.json'}
    bodies={name:archive.read(name) for name in allowed}
    for name,expected in manifest['files'].items():
        assert len(bodies[name])==expected['bytes'] and hashlib.sha256(bodies[name]).hexdigest()==expected['sha256']
    timeline=json.loads(bodies['timeline.json'])
    narration=json.loads(bodies['narration.json'])
    review=json.loads(bodies['scene-review.json'])
    assert timeline['source_plan_sha256']==narration['source_plan_sha256']==review['source_plan_sha256']==manifest['approvedPlanSha256']
    assert review['source']['webRelease']==args.release and review['live_capture_allowed'] is False and review['network_allowed'] is False
    out.mkdir()
    for name,value in bodies.items():
        target=(out/name).resolve()
        assert target.is_relative_to(out)
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(value)
(out/'download-receipt.json').write_text(json.dumps({'assetId':args.asset_id,'archiveSha256':args.sha256,'webRelease':args.release,'approvedPlanSha256':manifest['approvedPlanSha256'],'files':len(allowed)-1,'mode':manifest['mode']},indent=2)+'\n',encoding='utf-8')
print('Verified and extracted sealed scene-only project: '+str(len(allowed)-1)+' files; no capture or voice.')
