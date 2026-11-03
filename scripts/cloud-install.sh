#!/usr/bin/env bash
set -euo pipefail
cd /workspace/TRUSTEO
export NODE_USE_ENV_PROXY=1 NEXT_TELEMETRY_DISABLED=1 PRISMA_SKIP_POSTINSTALL_GENERATE=1
npm ci --strict-ssl=true --cache /workspace/.npm-cache
if [ ! -f .env ]; then cp .env.example .env; chmod 600 .env; fi
python3 - <<'PY'
from pathlib import Path
import os, secrets
p=Path('.env')
s=p.read_text()
if not os.environ.get('CREDENTIAL_ENCRYPTION_KEY'):
    if 'CREDENTIAL_ENCRYPTION_KEY=\n' in s:
        s=s.replace('CREDENTIAL_ENCRYPTION_KEY=\n','CREDENTIAL_ENCRYPTION_KEY='+secrets.token_hex(32)+'\n')
    elif not any(line.startswith('CREDENTIAL_ENCRYPTION_KEY=') for line in s.splitlines()):
        s+='\nCREDENTIAL_ENCRYPTION_KEY='+secrets.token_hex(32)+'\n'
p.write_text(s)
p.chmod(0o600)
PY
if [ ! -e apps/web/.env ] && [ ! -L apps/web/.env ]; then ln -s ../../.env apps/web/.env; fi
npm run providers:generate
npm run db:generate
bash scripts/cloud-services.sh
npm run db:migrate
