#!/usr/bin/env python3
"""Bundle only QA-approved app-owned illustrations without touching licensed assets.

Usage: python3 scripts/catalog/generated.py [--source-dir ~/.cache/gym-log-catalog/generated]
Run after generate.py when rebuilding the open-source base catalog. The manifest
records source hashes, accepted attempts, and rejected/pending attempts. PNGs stay
in the local cache, never in git. Re-running with the same PNGs is deterministic.
"""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
from generate import CACHE, OUT_IMAGES, OUT_JSON, ROOT, line_mask, slug

MANIFEST = Path(__file__).with_name('generated-manifest.json')
PROVENANCE_URL = 'https://github.com/eduard-cc/gym-log/blob/main/scripts/catalog/README.md'


def bundle(source_dir):
    entries = json.loads(OUT_JSON.read_text())
    manifest = json.loads(MANIFEST.read_text())
    by_name = {entry['name']: entry for entry in entries}
    approved = [item for item in manifest['exercises'] if item.get('acceptedAttempt')]
    prepared = []
    # Validate every input before writing any catalog asset.
    for item in approved:
        name = item['name']
        entry = by_name[name]
        attempts = [attempt for attempt in item['attempts']
                    if attempt['attempt'] == item['acceptedAttempt']]
        if len(attempts) != 1 or attempts[0]['verdict'] != 'PASS':
            raise ValueError(f'{name}: accepted attempt must have passed QA')
        filename = f'{slug(name)}-0.webp'
        source = source_dir / f'{slug(name)}.png'
        raw = source.read_bytes()
        if hashlib.sha256(raw).hexdigest() != item['sha256']:
            raise ValueError(f'{name}: source SHA-256 does not match the reviewed PNG')
        # Never replace a licensed illustration or append alongside one.
        existing_illustrations = [s for s in entry['sources'] if s['kind'] == 'illustration']
        if entry['images'] and (entry['images'][0]['file'] != filename
                                or len(entry['images']) != 1
                                or not existing_illustrations):
            raise ValueError(f'{name}: refusing to replace existing catalog images')
        if any(s['license'] != 'app-owned' for s in existing_illustrations):
            raise ValueError(f'{name}: refusing to alter licensed illustrations')
        if (OUT_IMAGES / filename).exists() and not entry['images']:
            raise ValueError(f'{name}: refusing to overwrite an unreferenced existing asset')
        data, size = line_mask(raw)
        if len(data) > 40 * 1024:
            raise ValueError(f'{name}: image exceeds catalog size budget')
        prepared.append((entry, filename, data, size))
    OUT_IMAGES.mkdir(parents=True, exist_ok=True)
    for entry, filename, data, size in prepared:
        (OUT_IMAGES / filename).write_bytes(data)
        entry['images'] = [{'file': filename, 'width': size[0], 'height': size[1]}]
        # Preserve every existing instruction/muscle source and its order/contents.
        entry['sources'] = [s for s in entry['sources'] if s['kind'] != 'illustration'] + [{
            'kind': 'illustration', 'title': entry['name'], 'author': 'Gym Log',
            'license': 'app-owned', 'licenseUrl': PROVENANCE_URL + '#app-owned-illustrations',
            'url': PROVENANCE_URL,
            'changes': 'AI-assisted illustration; cropped, resized and recoloured',
        }]
    formatted = subprocess.run(
        ['node', str(ROOT / 'node_modules/prettier/bin/prettier.cjs'),
         '--stdin-filepath', str(OUT_JSON)],
        input=json.dumps(entries, indent=2, ensure_ascii=False) + '\n',
        text=True, capture_output=True, check=True, cwd=ROOT,
    ).stdout
    OUT_JSON.write_text(formatted)
    total = sum(p.stat().st_size for p in OUT_IMAGES.glob('*.webp'))
    print(f'{len(prepared)} app-owned drawings bundled; '
          f'{sum(bool(e["images"]) for e in entries)}/{len(entries)} exercises illustrated; '
          f'{sum(not e["images"] for e in entries)} missing; '
          f'{total / 1024:.2f} KiB total image payload')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=CACHE / 'generated')
    bundle(parser.parse_args().source_dir)
