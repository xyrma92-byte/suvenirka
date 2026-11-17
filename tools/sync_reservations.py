#!/usr/bin/env python3
"""Синхронизация броней сайта и вкладки «Бронь».

  pull:  python3 tools/sync_reservations.py pull [bron.csv | URL опубликованного CSV]
         → reservations.js + reservations.json (только активные: статус «бронь» и срок не истёк).
         Сайт подхватывает reservations.js и на file://, и на GitHub Pages.
  push:  python3 tools/sync_reservations.py push zayavka-*.json [--dir /workspace/merch-inventory]
         → добавляет заявки с сайта в zakazy.csv / bron.csv и пишет bron_append.csv / zakazy_append.csv
           (строки, которые нужно вставить в конец вкладок — вручную или через Google Sheets).
"""
import glob, json, os, sys, urllib.request, io, csv
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
args = sys.argv[1:]
if not args or args[0] not in ('pull', 'push'): print(__doc__); sys.exit(1)
D = '/workspace/merch-inventory'
if '--dir' in args: i = args.index('--dir'); D = args[i+1]; del args[i:i+2]
if args[0] == 'pull':
    src = args[1] if len(args) > 1 else os.path.join(D, 'bron.csv')
    if src.startswith('http'):
        txt = urllib.request.urlopen(src).read().decode('utf-8-sig'); rows = list(csv.DictReader(io.StringIO(txt)))
    else: rows = read_csv(src)
    out = write_reservations_js(rows); print(f'Строк «Бронь»: {len(rows)}, активных: {len(out)} → reservations.js')
else:
    orders = read_csv(os.path.join(D, 'zakazy.csv')); res = read_csv(os.path.join(D, 'bron.csv'))
    known = {o['orderId'] for o in orders}; new_o, new_r = [], []
    for pat in args[1:]:
        for fn in glob.glob(pat):
            o = json.load(open(fn, encoding='utf-8'))
            if o.get('type') != 'catalog' or 'payment' not in o or o['id'] in known: continue
            orow, rrows = order_rows_from_json(o); new_o.append(orow); new_r += rrows; known.add(o['id'])
    write_csv(os.path.join(D, 'zakazy.csv'), orders + new_o, ORDER_HEAD); write_csv(os.path.join(D, 'bron.csv'), res + new_r, RES_HEAD)
    write_csv(os.path.join(D, 'zakazy_append.csv'), new_o, ORDER_HEAD); write_csv(os.path.join(D, 'bron_append.csv'), new_r, RES_HEAD)
    write_reservations_js(res + new_r)
    print(f'Новых заказов: {len(new_o)}, строк брони: {len(new_r)} → zakazy_append.csv / bron_append.csv, reservations.js обновлён')
