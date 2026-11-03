#!/usr/bin/env bash
# Downloads the Sport5 style examples listed in config/style_sources.json into style/<group>/<id>.txt
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -I - <<'PY'
import json, re, subprocess, os
src = json.load(open('config/style_sources.json', encoding='utf-8'))
for group in ('nights', 'avdija'):
    os.makedirs(f'style/{group}', exist_ok=True)
    os.makedirs('style/raw', exist_ok=True)
    for url in src[group]:
        doc = re.search(r'docID=(\d+)', url).group(1)
        name = ('d' if group == 'nights' else 'a') + doc
        html = f'style/raw/{name}.html'
        subprocess.run(['curl', '-s', '-m', '30', '-A', 'Mozilla/5.0 (compatible; ModAI/0.2)', '-o', html, url], check=True)
        subprocess.run(['python3', '-I', 'scripts/extract_sport5.py', html, f'style/{group}/{name}.txt'], check=True)
PY
