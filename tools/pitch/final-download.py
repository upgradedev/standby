"""Acquire one sealed final-render packet from an unpublished own-repository draft."""
import argparse
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import time
import urllib.request
import zipfile
import io
from final_contract import ASSET, INDEX, MAX_ARCHIVE, PLAN, WEB, require, sha, validate_archive


def acquire(args):
    require(os.environ.get('GITHUB_ACTIONS') == 'true', 'Hosted acquisition only')
    require(all(re.fullmatch(r'[1-9][0-9]{0,19}', x) for x in [args.asset_id, args.draft_release_id]), 'Numeric draft and asset IDs required')
    require(re.fullmatch(r'[a-f0-9]{64}', args.sha256), 'Exact archive hash required')
    out, temp = Path(args.out).resolve(), Path(os.environ['RUNNER_TEMP']).resolve()
    require(out.is_relative_to(temp) and out != temp and not out.exists(), 'Fresh CI temp workspace required')
    # Exactly one literal readiness GET. Never follow a redirect or evaluate the app.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *unused):
            return None
    url = 'https://d34x1513u5u1qs.cloudfront.net/capacity'
    with urllib.request.build_opener(NoRedirect).open(urllib.request.Request(url, headers={'Cache-Control': 'no-cache'}), timeout=30) as response:
        require(response.status == 200 and response.url == url, 'Judge URL must return HTTP200')
        index = response.read(4 * 1024 * 1024 + 1)
    require(len(index) <= 4 * 1024 * 1024 and sha(index) == INDEX, 'Frozen served index changed')
    prefix = 'repos/upgradedev/standby/releases/'
    draft = json.loads(subprocess.run(['gh', 'api', prefix + args.draft_release_id], capture_output=True, check=True, timeout=30).stdout)
    require(draft['draft'] is True and str(draft['id']) == args.draft_release_id, 'Unpublished own-repository draft required')
    assets = [x for x in draft['assets'] if str(x['id']) == args.asset_id]
    require(len(assets) == 1, 'Asset is not part of the selected draft')
    asset = assets[0]
    require(asset['name'] == ASSET and asset['state'] == 'uploaded' and 0 < asset['size'] <= MAX_ARCHIVE, 'Unexpected final packet asset')
    process = subprocess.Popen(['gh', 'api', prefix + 'assets/' + args.asset_id, '-H', 'Accept: application/octet-stream'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    raw, deadline = bytearray(), time.monotonic() + 120
    try:
        os.set_blocking(process.stdout.fileno(), False)
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            ended = False
            while not ended:
                require(time.monotonic() < deadline, 'Archive transfer deadline')
                for key, _ in selector.select(min(1, deadline - time.monotonic())):
                    chunk = os.read(key.fileobj.fileno(), min(65536, MAX_ARCHIVE + 1 - len(raw)))
                    if not chunk:
                        ended = True
                        break
                    raw.extend(chunk)
                    require(len(raw) <= MAX_ARCHIVE, 'Archive exceeded limit')
            process.wait(timeout=max(.01, deadline - time.monotonic()))
        require(process.returncode == 0 and len(raw) == asset['size'] and sha(raw) == args.sha256, 'Archive bytes/hash changed')
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
        process.stdout.close()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        bodies = validate_archive(archive)
    out.mkdir()
    for name, body in bodies.items():
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    receipt = {'status': 'SEALED_FINAL_INPUTS_VERIFIED_NO_CODE_EXECUTED', 'assetId': args.asset_id,
               'draftReleaseId': args.draft_release_id, 'archiveSha256': args.sha256,
               'sourcePlanSha256': PLAN, 'webRelease': WEB, 'files': len(bodies),
               'judgeReadiness': {'url': url, 'status': 200, 'indexSha256': INDEX},
               'productEvaluations': 0, 'captures': 0, 'voiceCalls': 0}
    (out / 'download-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    print('PASS sealed final inputs acquired; one read-only judge readiness GET, no app evaluation, capture or voice call.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ['asset-id', 'draft-release-id', 'sha256', 'out']:
        parser.add_argument('--' + option, required=True)
    acquire(parser.parse_args())
