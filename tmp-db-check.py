from pathlib import Path
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse
import subprocess, sys

def read_env():
    out={}
    for line in Path('.env').read_text().splitlines():
        line=line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k,v=line.split('=',1)
        out[k]=v.strip().strip('"').strip("'")
    return out

def require_ssl(url):
    p=urlparse(url)
    q=dict(parse_qsl(p.query, keep_blank_values=True))
    q.setdefault('sslmode','require')
    return urlunparse((p.scheme,p.netloc,p.path,p.params,urlencode(q),p.fragment))

env=read_env()
source=env.get('DATABASE_URL')
target=env.get('TARGET_DUMP')
if not source or not target:
    raise SystemExit('DATABASE_URL or TARGET_DUMP missing')
target=require_ssl(target)
checks=[('source', source), ('target', target)]
for name,url in checks:
    cmd=['psql', url, '-Atc', "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';"]
    try:
        result=subprocess.run(cmd, text=True, capture_output=True, timeout=30)
    except Exception as e:
        print(f'{name}: connection_error {e.__class__.__name__}')
        sys.exit(2)
    if result.returncode:
        print(f'{name}: psql_failed {result.stderr.strip().splitlines()[-1] if result.stderr.strip() else result.returncode}')
        sys.exit(result.returncode)
    print(f'{name}_table_count={result.stdout.strip()}')
