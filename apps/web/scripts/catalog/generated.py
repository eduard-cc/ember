#!/usr/bin/env python3
"""Bundle only QA-accepted app-owned (AI-assisted) illustrations without touching licensed assets.

Usage: python3 scripts/catalog/generated.py [--source-dir ~/.cache/ember-catalog/generated]

The source directory holds one QA record per exercise (qa/<slug>.json, status
accepted|rejected|unreviewed|replaced) and accepted raw PNGs. `replaced` marks a drawing
superseded by a licensed one that generate.py now bundles. A record's ordered `poses`
list (accepted/<slug>-0.png start, -1.png finish) becomes a start/finish pair;
records without it bundle the single accepted/<slug>.png. Only accepted records
whose PNGs match their recorded SHA-256 are bundled.
App-owned drawings that are no longer accepted are removed; licensed Everkinetic/wger
drawings and their sources are never modified. All inputs are validated before any
catalog file changes. PNGs stay outside git. Re-running with the same cache is
deterministic. Run after generate.py when rebuilding the licensed base catalog.
"""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
from generate import CACHE, OUT_IMAGES, OUT_JSON, ROOT, normalised_mask, slug

MANIFEST = Path(__file__).with_name('generated-manifest.json')
PROVENANCE_URL = 'https://github.com/eduard-cc/ember/blob/main/apps/web/scripts/catalog/README.md'
AUTHOR = 'Ember (AI-assisted, gpt-image-2)'
LICENSE = 'app-owned'
CHANGES = ('AI-assisted illustration made for Ember, not an Everkinetic or wger work; '
           'cropped, resized, recoloured and line width normalised')


def is_app_owned(source):
    return source['kind'] == 'illustration' and source['license'] == LICENSE


def load_records(source_dir):
    records = {}
    for path in sorted((source_dir / 'qa').glob('*.json')):
        record = json.loads(path.read_text())
        if record.get('status') not in ('accepted', 'rejected', 'unreviewed', 'replaced'):
            raise ValueError(f'{path.stem}: unknown QA status {record.get("status")!r}')
        records[path.stem] = record
    if not records:
        raise ValueError(f'no QA records in {source_dir / "qa"}')
    return records


def bundle(source_dir):
    entries = json.loads(OUT_JSON.read_text())
    by_slug = {slug(entry['name']): entry for entry in entries}
    records = load_records(source_dir)
    unknown = sorted(set(records) - set(by_slug))
    if unknown:
        raise ValueError(f'QA records without a catalog exercise: {unknown}')

    # A replaced AI drawing needs the licensed drawing that replaced it.
    for key, record in records.items():
        if record['status'] == 'replaced' and not any(
                s['kind'] == 'illustration' and not is_app_owned(s) for s in by_slug[key]['sources']):
            raise ValueError(f'{by_slug[key]["name"]}: replaced AI drawing has no licensed drawing')

    # Validate every input before writing any catalog asset.
    prepared = []
    for key, record in records.items():
        if record['status'] != 'accepted':
            continue
        entry = by_slug[key]
        # Owner-reviewed start/finish pairs list their poses in order; older records hold one drawing.
        poses = record.get('poses') or [{'file': f'{key}.png', 'sha256': record.get('sha256')}]
        if len(poses) not in (1, 2):
            raise ValueError(f'{entry["name"]}: expected one drawing or a start/finish pair')
        for pose in poses:
            if Path(pose.get('file', '')).name != pose.get('file') or not pose.get('sha256'):
                raise ValueError(f'{entry["name"]}: each pose needs a plain filename and SHA-256')
        illustrations = [s for s in entry['sources'] if s['kind'] == 'illustration']
        if any(not is_app_owned(s) for s in illustrations):
            raise ValueError(f'{entry["name"]}: refusing to replace a licensed illustration')
        if entry['images'] and not illustrations:
            raise ValueError(f'{entry["name"]}: refusing to replace unattributed images')
        images = []
        for pose in poses:
            raw = (source_dir / 'accepted' / pose['file']).read_bytes()
            if hashlib.sha256(raw).hexdigest() != pose['sha256']:
                raise ValueError(f'{entry["name"]}: {pose["file"]} does not match the reviewed PNG')
            data, size = normalised_mask(raw)
            if len(data) > 40 * 1024:
                raise ValueError(f'{entry["name"]}: image exceeds catalog size budget')
            images.append((data, size))
        prepared.append((key, entry, images, [p['sha256'] for p in poses]))

    accepted = {key for key, *_ in prepared}
    # A partially restored cache must not silently drop drawings that are still bundled.
    orphaned = sorted(entry['name'] for key, entry in by_slug.items()
                      if any(is_app_owned(s) for s in entry['sources']) and key not in records)
    if orphaned:
        raise ValueError(f'bundled AI drawings without a QA record: {orphaned}')
    removed, stale_files = [], []
    for key, entry in by_slug.items():
        if any(is_app_owned(s) for s in entry['sources']) and key not in accepted:
            stale_files += [OUT_IMAGES / image['file'] for image in entry['images']]
            entry['images'] = []
            entry['sources'] = [s for s in entry['sources'] if not is_app_owned(s)]
            removed.append(entry['name'])

    for key, entry, images, _ in prepared:
        stale_files += [OUT_IMAGES / image['file'] for image in entry['images']]
        entry['images'] = [{'file': f'{key}-{i}.webp', 'width': size[0], 'height': size[1]}
                           for i, (_, size) in enumerate(images)]
        entry['sources'] = [{
            'kind': 'illustration', 'title': entry['name'], 'author': AUTHOR,
            'license': LICENSE, 'licenseUrl': PROVENANCE_URL + '#app-owned-illustrations',
            'url': PROVENANCE_URL, 'changes': CHANGES,
        }]

    hashes = {key: shas for key, _, _, shas in prepared}
    manifest = {
        'schemaVersion': 3,
        'model': 'gpt-image-2 (image_generate)',
        'conversion': ('generate.normalised_mask: stroke.normalise (line width 2.1px), then '
                       'line_mask (MAX_SIDE=240, LEVELS=8, lossless WebP method=4)'),
        'review': ('Accepted only after a style audit against Everkinetic references, an '
                   'independent strict physical-logic audit of the raw image, and a 240px '
                   'mask check beside licensed drawings on light and dark backgrounds.'),
        'exercises': [
            {
                'name': by_slug[key]['name'],
                'status': record['status'],
                'attempts': record.get('attempts', 0),
                **({'sha256': hashes[key][-1]} if key in hashes else {}),
                **({'startSha256': hashes[key][0]} if len(hashes.get(key, [])) == 2 else {}),
                **({'postProcessed': 'local line cleanup or thickening, re-audited'}
                   if record['status'] == 'accepted' and record.get('derived_from') else {}),
            }
            for key, record in records.items()
        ],
    }
    formatted = subprocess.run(
        ['node', str(ROOT / 'node_modules/prettier/bin/prettier.cjs'),
         '--stdin-filepath', str(OUT_JSON)],
        input=json.dumps(entries, indent=2, ensure_ascii=False) + '\n',
        text=True, capture_output=True, check=True, cwd=ROOT,
    ).stdout
    # Only now, with every input validated and every output computed, touch the tree.
    for path in stale_files:
        path.unlink(missing_ok=True)
    OUT_IMAGES.mkdir(parents=True, exist_ok=True)
    for key, _, images, _ in prepared:
        for i, (data, _) in enumerate(images):
            (OUT_IMAGES / f'{key}-{i}.webp').write_bytes(data)
    MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n')
    OUT_JSON.write_text(formatted)
    total = sum(p.stat().st_size for p in OUT_IMAGES.glob('*.webp'))
    print(f'{len(prepared)} app-owned drawings bundled; removed: {removed or "none"}; '
          f'{sum(bool(e["images"]) for e in entries)}/{len(entries)} exercises illustrated; '
          f'{sum(not e["images"] for e in entries)} missing; '
          f'{total / 1024:.2f} KiB total image payload')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=CACHE / 'generated')
    bundle(parser.parse_args().source_dir.expanduser())
