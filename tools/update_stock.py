#!/usr/bin/env python3
"""Обновляет остатки (stock) в products.json/products.js из CSV-выгрузок вкладок «Склад …».
Использование: python3 tools/update_stock.py /workspace/merch-inventory
Ожидает файлы sklad_breloki.csv, sklad_znachki.csv, sklad_magnity.csv, sklad_sergi.csv
с колонками: Название товара, Склад, Озон склад, Количество. stock = Количество (>0), иначе null (под заказ)."""
import csv, json, re, sys, os, difflib
SRC = sys.argv[1] if len(sys.argv) > 1 else '/workspace/merch-inventory'
SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = {'keychains':'sklad_breloki.csv','pins':'sklad_znachki.csv','magnets':'sklad_magnity.csv','earrings':'sklad_sergi.csv'}
# ручные соответствия: нормализованное имя на складе -> нормализованное имя в каталоге
ALIASES = {'bullet for me valentine':'bullet for my valentine','pink floid':'pink floyd','powerwolt':'powerwolf',
           'amon amarts':'amon amarth','кино виктор цой':'цой','цой кино':'цой','ozzy':'ozzy osbourne',
           'dimmer borgir':'dimmu borgir','rock серьги':'rock','король и шут':'король и шут лого'}
LOOK = str.maketrans('аеорсхукмтв', 'aeopcxykmtb')
def norm(s):
    s = (s or '').lower().replace('ё','е').replace('&','and')
    s = re.sub(r'[^0-9a-zа-я ]+', '', s)
    # слова с латиницей: заменить кириллические «двойники» (Dimmu bоrgir с русской «о»)
    s = ' '.join(w.translate(LOOK) if re.search(r'[a-z]', w) else w for w in s.split())
    s = re.sub(r'^the ', '', s)
    return re.sub(r'\s+', ' ', s).strip()
def split_num(n):
    m = re.match(r'^(\d+) (.+)$', n)          # "2 eskimo callboy" -> base, 2  (не трогаем "21 pilots", "30 seconds")
    if m and int(m.group(1)) <= 5 and not re.match(r'^(21|30)', n): return m.group(2), int(m.group(1))
    m = re.match(r'^(.+?) (\d)$', n)
    if m: return m.group(1), int(m.group(2))
    return n, 1
def key(name):
    b, k = split_num(norm(name)); b = ALIASES.get(b, b); return b, k
P = json.load(open(os.path.join(SITE,'products.json')))
for p in P: p['stock'] = None; p.pop('stockWarehouse', None); p.pop('stockOzon', None); p.pop('stockRows', None)
report = {}
for cat, fn in FILES.items():
    rows = list(csv.DictReader(open(os.path.join(SRC, fn), encoding='utf-8-sig')))
    items = [p for p in P if p['category'] == cat]
    idx = {}
    for p in items: idx.setdefault(key(p['name']), []).append(p)
    bases = sorted({k[0] for k in idx})
    matched, unmatched, dup = [], [], []
    agg = {}
    for r in rows:
        name = (r.get('Название товара') or '').strip()
        if not name: continue
        def toi(v):
            try: return int(float(str(v).replace(',', '.').replace(' ', '') or 0))
            except: return 0
        qty = toi(r.get('Количество')); wh = toi(r.get('Склад')); oz = toi(r.get('Озон склад') or r.get('Озон склад '))
        b, k = key(name)
        target = idx.get((b, k))
        how = 'exact'
        if not target:
            cand = difflib.get_close_matches(b, bases, n=1, cutoff=0.82)
            if cand and (cand[0], k) in idx: target = idx[(cand[0], k)]; how = f'fuzzy→{cand[0]}'
        if not target: unmatched.append((name, qty)); continue
        p = target[0]
        if p['id'] in agg: dup.append(name)
        a = agg.setdefault(p['id'], [0,0,0]); a[0]+=qty; a[1]+=wh; a[2]+=oz
        p.setdefault('stockRows', []).append(name)  # имя строки на вкладке «Склад …» — для списания в process_orders.py
        matched.append((name, p['name'], qty, how))
    for pid, (q, wh, oz) in agg.items():
        p = next(x for x in P if x['id'] == pid)
        p['stock'] = q if q > 0 else None; p['stockWarehouse'] = wh; p['stockOzon'] = oz
    report[cat] = dict(sheetRows=len([r for r in rows if (r.get('Название товара') or '').strip()]), matchedRows=len(matched),
        unmatchedRows=unmatched, duplicatesSummed=dup, catalogItems=len(items),
        inStock=sum(1 for p in items if p['stock']), madeToOrder=sum(1 for p in items if not p['stock']),
        fuzzy=[m for m in matched if m[3] != 'exact'])
json.dump(P, open(os.path.join(SITE,'products.json'),'w'), ensure_ascii=False, indent=1)
open(os.path.join(SITE,'products.js'),'w').write('// Сгенерировано: каталог xlsx + остатки из Google Sheets «Сувенирка» (вкладки «Склад …», колонка «Количество»). stock=null → под заказ.\nwindow.PRODUCTS=' + json.dumps(P, ensure_ascii=False) + ';\n')
json.dump(report, open(os.path.join(SRC,'stock_match_report.json'),'w'), ensure_ascii=False, indent=1)
for c, r in report.items():
    print(f"{c}: sheet rows {r['sheetRows']}, matched {r['matchedRows']}, unmatched {len(r['unmatchedRows'])}; catalog {r['catalogItems']}: in stock {r['inStock']}, под заказ {r['madeToOrder']}")
    if r['unmatchedRows']: print('   UNMATCHED:', r['unmatchedRows'])
    if r['fuzzy']: print('   FUZZY:', [(a,b) for a,b,_,_ in r['fuzzy']])
    if r['duplicatesSummed']: print('   DUP summed:', r['duplicatesSummed'])
