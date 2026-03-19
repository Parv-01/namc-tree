#!/usr/bin/env python3
"""
scripts/generate_data_js.py
────────────────────────────
Re-generate  data.js  and  tree_data.js  from an updated Excel / CSV file.

Usage:
    python3 scripts/generate_data_js.py

Requirements:
    pip install pandas openpyxl

Input files expected (any one of):
    NATIONAL_AYURVEDA_MORBIDITY_CODES.xls   (original)
    NATIONAL_AYURVEDA_MORBIDITY_CODES.xlsx
    NATIONAL_AYURVEDA_MORBIDITY_CODES.csv   (use if soffice converted)

Output:
    data.js          →  JavaScript file with all NAMC records as a const object
"""

import json, os, sys, subprocess, textwrap
from pathlib import Path

ROOT = Path(__file__).parent.parent          # project root
DATA_JS   = ROOT / 'data.js'

# ── Locate the Excel / CSV source ──────────────────────────────
CANDIDATES = [
    ROOT / 'NATIONAL_AYURVEDA_MORBIDITY_CODES.xls',
    ROOT / 'NATIONAL_AYURVEDA_MORBIDITY_CODES.xlsx',
    ROOT / 'NATIONAL_AYURVEDA_MORBIDITY_CODES.csv',
    ROOT / 'scripts' / 'NATIONAL_AYURVEDA_MORBIDITY_CODES.csv',
]

source_file = next((p for p in CANDIDATES if p.exists()), None)
if source_file is None:
    sys.exit(
        'ERROR: Could not find NATIONAL_AYURVEDA_MORBIDITY_CODES.xls/.xlsx/.csv\n'
        f'Searched: {[str(p) for p in CANDIDATES]}'
    )

print(f'Using source: {source_file}')

# ── Convert .xls to CSV via LibreOffice if needed ───────────────
csv_path = source_file
if source_file.suffix in ('.xls', '.xlsx'):
    tmp_dir = ROOT / 'scripts' / '_tmp'
    tmp_dir.mkdir(exist_ok=True)
    print(f'Converting {source_file.name} → CSV via LibreOffice…')
    result = subprocess.run(
        ['soffice', '--headless', '--convert-to', 'csv',
         '--outdir', str(tmp_dir), str(source_file)],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        sys.exit(f'LibreOffice conversion failed:\n{result.stderr}')
    csv_path = tmp_dir / (source_file.stem + '.csv')
    if not csv_path.exists():
        sys.exit(f'Conversion produced no CSV file in {tmp_dir}')
    print(f'Converted → {csv_path}')

# ── Read CSV ────────────────────────────────────────────────────
try:
    import pandas as pd
except ImportError:
    sys.exit('ERROR: pandas not installed. Run: pip install pandas')

df = pd.read_csv(csv_path, encoding='utf-8', on_bad_lines='skip')
df = df.fillna('').replace('-', '').astype(str).replace('nan', '')
print(f'Loaded {len(df)} rows, {len(df.columns)} columns.')

REQUIRED = ['NAMC_CODE', 'NAMC_term', 'NAMC_term_diacritical',
            'NAMC_term_DEVANAGARI', 'Name English',
            'Short_definition', 'Long_definition', 'Ontology_branches']

missing = [c for c in REQUIRED if c not in df.columns]
if missing:
    sys.exit(f'ERROR: Missing columns: {missing}\nFound: {df.columns.tolist()}')

# ── Build records dict ──────────────────────────────────────────
records = {}
skipped = 0
for _, row in df.iterrows():
    code = row['NAMC_CODE'].strip()
    if not code:
        skipped += 1
        continue
    records[code] = {
        'term':     row['NAMC_term'].strip(),
        'diac':     row['NAMC_term_diacritical'].strip(),
        'dev':      row['NAMC_term_DEVANAGARI'].strip(),
        'en':       row['Name English'].strip(),
        'short':    row['Short_definition'].strip(),
        'long':     row['Long_definition'].strip(),
        'ontology': row['Ontology_branches'].strip(),
        'sr':       row['Sr No.'].strip()  if 'Sr No.' in df.columns else '',
        'id':       row['NAMC_ID'].strip() if 'NAMC_ID' in df.columns else '',
    }

print(f'Built {len(records)} records (skipped {skipped} empty codes).')

# ── Write data.js ───────────────────────────────────────────────
data_json = json.dumps(records, ensure_ascii=False, separators=(',', ':'))
has_def   = sum(1 for v in records.values() if v['long'])

data_js_content = f"""\
/* ═══════════════════════════════════════════════════════════════
   data.js  –  Embedded Excel data (auto-generated)
   Source: {source_file.name}
   Records: {len(records)}
   Definitions: {has_def}
   
   Fields per record:
     term     – Sanskrit transliteration   (NAMC_term)
     diac     – Diacritical form           (NAMC_term_diacritical)
     dev      – Devanāgarī script          (NAMC_term_DEVANAGARI)
     en       – English name               (Name English)
     short    – Short definition           (Short_definition)
     long     – Long definition            (Long_definition)
     ontology – Ontology branches cross-ref
     sr       – Serial number
     id       – NAMC_ID
   
   Regenerate: python3 scripts/generate_data_js.py
   ═══════════════════════════════════════════════════════════════ */

/* global NAMC_DATA */
const NAMC_DATA = {data_json};
"""

DATA_JS.write_text(data_js_content, encoding='utf-8')
print(f'✓ Wrote {DATA_JS} ({DATA_JS.stat().st_size // 1024} KB)')
print('Done.')
