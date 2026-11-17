#!/usr/bin/env python3
"""Обработка заказов: продажа = статус «оплачен».

Работает с CSV-выгрузками вкладок внутренней таблицы (по умолчанию папка /workspace/merch-inventory):
  zakazy.csv  — вкладка «Заказы»      bron.csv — вкладка «Бронь»
  sklad_breloki.csv, sklad_znachki.csv, sklad_magnity.csv, sklad_sergi.csv — вкладки «Склад …»

  python3 tools/process_orders.py [папка] [--import zayavka-*.json ...] [--now "29.10.2026 12:00"] [--dry-run] [--no-site]

Что делает (идемпотентно — повторный запуск ничего не списывает дважды):
  1. --import: заявки с сайта (JSON) → новые строки в «Заказы» (статус «бронь») и «Бронь».
  2. «Заказы»: статус «оплачен» и пустое «Списано со склада» → для каждой строки «Бронь» этого заказа
     уменьшает «Количество» на вкладке «Склад …» (по имени строки), строки брони → «оплачен», «Списано» = дата.
     Списывается только забронированное количество из наличия; «под заказ» изготавливается и склад не трогает.
  3. «снята» в «Заказы» → брони заказа «снята» (склад не меняется).
  4. «бронь», срок истёк → «истекла» в обеих вкладках; количество снова доступно к продаже (склад не меняется).
  5. Пишет обновлённые CSV, changes-<дата>.json (что поменять в Google Sheets: вкладка/строка/значение),
     reservations.js (активные брони для сайта) и обновляет остатки сайта (tools/update_stock.py).
"""
import argparse, glob, json, os, subprocess, sys, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

ap = argparse.ArgumentParser()
ap.add_argument('dir', nargs='?', default='/workspace/merch-inventory')
ap.add_argument('--import', dest='imports', nargs='*', default=[])
ap.add_argument('--now'); ap.add_argument('--dry-run', action='store_true'); ap.add_argument('--no-site', action='store_true')
a = ap.parse_args()
now = parse_dt(a.now) if a.now else now_local()
D = a.dir
orders = read_csv(os.path.join(D, 'zakazy.csv')); res = read_csv(os.path.join(D, 'bron.csv'))
P = products()
stock = {cat: read_csv(os.path.join(D, fn)) for cat, fn in STOCK_FILES.items()}
changes, log = [], []

# 1. import
known = {o['orderId'] for o in orders}
for pat in a.imports:
    for fn in glob.glob(pat):
        o = json.load(open(fn, encoding='utf-8'))
        if o.get('type') != 'catalog' or 'payment' not in o or o['id'] in known: continue
        orow, rrows = order_rows_from_json(o); orders.append(orow); res.extend(rrows); known.add(o['id'])
        changes.append({'action': 'append', 'tab': 'Заказы', 'values': [orow.get(h, '') for h in ORDER_HEAD]})
        for r in rrows: changes.append({'action': 'append', 'tab': 'Бронь', 'values': [r.get(h, '') for h in RES_HEAD]})
        log.append(f'+ импорт {o["id"]}: {len(rrows)} строк брони')

def set_cell(tab, rows, i, col, val):
    old = rows[i].get(col, '')
    if str(old) == str(val): return
    rows[i][col] = val
    changes.append({'action': 'update', 'tab': tab, 'row': i + 2, 'column': col, 'old': old, 'new': val})

by_order = {}
for i, r in enumerate(res): by_order.setdefault(r['orderId'], []).append(i)

def deduct(r):
    p = P.get(r['productId'])
    cat = r.get('category') or (p or {}).get('category')
    names = [n.strip().lower() for n in ((r.get('Строка склада') or '').split(' | ') if (r.get('Строка склада') or '').strip() else ((p or {}).get('stockRows') or [r.get('productName', '')]))]
    left = to_int(r['qty']); rows = stock.get(cat, [])
    for i, s in enumerate(rows):
        if left <= 0: break
        if (s.get('Название товара') or '').strip().lower() in names:
            q = to_int(s.get('Количество')); take = min(q, left)
            if take: set_cell(STOCK_TABS[cat], rows, i, 'Количество', q - take); left -= take
    if left > 0: log.append(f'  ! {r["productName"]} ({cat}): на складе не хватило {left} шт — проверьте вручную')
    return to_int(r['qty']) - left

for oi, o in enumerate(orders):
    st, oid = status(o.get('Статус')), o['orderId']
    lines = by_order.get(oid, [])
    if st == 'оплачен' and not (o.get('Списано со склада') or '').strip():
        total = 0
        for i in lines:
            r = res[i]
            if (r.get('Списано') or '').strip(): continue
            total += deduct(r)
            set_cell('Бронь', res, i, 'status', 'оплачен'); set_cell('Бронь', res, i, 'Списано', fmt_dt(now))
        set_cell('Заказы', orders, oi, 'Списано со склада', f'да, {fmt_dt(now)}')
        log.append(f'✓ {oid} оплачен: списано {total} шт со склада')
    elif st == 'снята':
        for i in lines:
            if status(res[i].get('status')) == 'бронь': set_cell('Бронь', res, i, 'status', 'снята')
        if lines: log.append(f'– {oid} снята: бронь освобождена')
    elif st == 'бронь':
        exp = parse_dt(o.get('Бронь до')) or min([parse_dt(res[i].get('expiresAt')) for i in lines if parse_dt(res[i].get('expiresAt'))] or [None])
        if exp and exp <= now:
            set_cell('Заказы', orders, oi, 'Статус', 'истекла')
            for i in lines:
                if status(res[i].get('status')) == 'бронь': set_cell('Бронь', res, i, 'status', 'истекла')
            log.append(f'⌛ {oid}: бронь истекла ({fmt_dt(exp)}), товар снова к продаже')
# брони без строки в «Заказы»
for i, r in enumerate(res):
    exp = parse_dt(r.get('expiresAt'))
    if status(r.get('status')) == 'бронь' and exp and exp <= now and r['orderId'] not in known:
        set_cell('Бронь', res, i, 'status', 'истекла')

print('\n'.join(log) or 'Изменений нет'); print(f'Изменений для таблицы: {len(changes)}')
if a.dry_run: sys.exit()
write_csv(os.path.join(D, 'zakazy.csv'), orders, ORDER_HEAD); write_csv(os.path.join(D, 'bron.csv'), res, RES_HEAD)
for cat, fn in STOCK_FILES.items():
    if stock[cat]: write_csv(os.path.join(D, fn), stock[cat], list(stock[cat][0].keys()))
if changes:
    cf = os.path.join(D, f'changes-{now:%Y%m%d-%H%M%S}.json')
    json.dump({'generatedAt': now.isoformat(), 'spreadsheetId': '1ZtqwBe0zvmxQYLmPgQ9FXOSHDOSGvEl4eNgmZrvte8Q', 'changes': changes},
              open(cf, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('Список правок для Google Sheets:', cf)
act = write_reservations_js(res); print(f'reservations.js: активных броней {len(act)}')
if not a.no_site: subprocess.run([sys.executable, os.path.join(SITE, 'tools', 'update_stock.py'), D], check=False, stdout=subprocess.DEVNULL)
