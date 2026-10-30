"""Offline scan of tracked original source, excluding only this scanner's patterns."""
import pathlib,re,subprocess,sys
patterns=[re.compile(r'AKIA[0-9A-Z]{16}'),re.compile(r'ASIA[0-9A-Z]{16}'),re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),re.compile(r'gh[pousr]_[A-Za-z0-9]{30,}')]
bad=[]
for name in subprocess.check_output(['git','ls-files','-z']).decode().split('\0'):
    if not name or name=='scripts/check-secrets.py': continue
    path=pathlib.Path(name)
    if not path.is_file(): continue
    try: data=path.read_text(encoding='utf-8')
    except UnicodeError: continue
    if any(p.search(data) for p in patterns): bad.append(name)
    if '.runtime/' in name or 'node_modules/' in name: bad.append(name)
if bad:
    print('Secret/runtime artifact scan failed:',','.join(bad));sys.exit(1)
print('Tracked source secret/runtime artifact scan passed')
