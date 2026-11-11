#!/usr/bin/env python3
"""Apply the reviewed muscle table (muscles.json) to the bundled catalog.

`muscles.json` gives every catalog exercise its primary and secondary muscles in Ember's
vocabulary. They are app-owned, reviewed facts, so the catalog no longer carries a wger
"muscles" source. `generate.py` calls `apply` on every full rebuild; run this script on its own
after editing the table:

  python3 scripts/catalog/muscles.py
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TABLE = Path(__file__).with_name('muscles.json')
CATALOG = ROOT / 'src/catalog/exercises.json'

# Keep in sync with `muscles` in src/catalog/catalog.ts.
MUSCLES = [
    'Chest', 'Front delts', 'Side delts', 'Rear delts', 'Biceps', 'Triceps', 'Forearms', 'Abs',
    'Obliques', 'Traps', 'Upper back', 'Lats', 'Lower back', 'Glutes', 'Quads', 'Hamstrings',
    'Adductors', 'Calves', 'Hip flexors', 'Rotator cuff',
]


def load_table():
    return json.loads(TABLE.read_text())


def apply(entries, table=None):
    """Set every entry's muscles from the table; refuse gaps, extras and unknown names."""
    table = load_table() if table is None else table
    names = [entry['name'] for entry in entries]
    missing = [n for n in names if n not in table]
    extra = [n for n in table if n not in names]
    if missing or extra:
        sys.exit(f'muscles.json does not match the catalog: missing {missing}, extra {extra}')
    for entry in entries:
        row = table[entry['name']]
        primary, secondary = row['primary'], row['secondary']
        unknown = [m for m in primary + secondary if m not in MUSCLES]
        if unknown or not primary or set(primary) & set(secondary) \
                or len(set(primary)) != len(primary) or len(set(secondary)) != len(secondary):
            sys.exit(f'{entry["name"]}: invalid muscles {row}')
        entry['primaryMuscles'] = list(primary)
        entry['secondaryMuscles'] = list(secondary)
        entry['sources'] = [s for s in entry['sources'] if s['kind'] != 'muscles']
    return entries


def main():
    entries = apply(json.loads(CATALOG.read_text()))
    # Same formatting as generated.py: the repository's Prettier.
    formatted = subprocess.run(
        ['node', str(ROOT / 'node_modules/prettier/bin/prettier.cjs'),
         '--stdin-filepath', str(CATALOG)],
        input=json.dumps(entries, indent=2, ensure_ascii=False) + '\n',
        text=True, capture_output=True, check=True, cwd=ROOT,
    ).stdout
    CATALOG.write_text(formatted)
    print(f'{len(entries)} exercises tagged')


if __name__ == '__main__':
    main()
