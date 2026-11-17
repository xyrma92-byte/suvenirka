"""Общие функции для process_orders.py / sync_reservations.py."""
import csv, json, os, datetime as dt
from zoneinfo import ZoneInfo
# Часовой пояс учёта (СПб). Можно переопределить: MERCH_TZ=Asia/Saigon python3 tools/...
TZ = ZoneInfo(os.environ.get('MERCH_TZ', 'Europe/Moscow'))
def now_local(): return dt.datetime.now(TZ)
SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATUSES = ('бронь', 'оплачен', 'снята', 'истекла')
ORDER_HEAD = ['orderId','Дата выставления','Режим','Способ оплаты','Счёт №','Клиент','Телефон','Email','Компания',
              'Сумма товаров, ₽','НДС / наценка, ₽','К оплате, ₽','Бронь до','Статус','Списано со склада','Комментарий']
RES_HEAD = ['orderId','dateIssued','expiresAt','productId','productName','category','qty','status','paymentMethod','customer','Строка склада','Списано']
STOCK_FILES = {'keychains':'sklad_breloki.csv','pins':'sklad_znachki.csv','magnets':'sklad_magnity.csv','earrings':'sklad_sergi.csv'}
# Вкладки во внутренней таблице 1ZtqwBe0… (данные лежат во вкладках «(копия)»; в «Сувенирке» — без «(копия)»)
STOCK_TABS = {'keychains':'Склад брелки (копия)','pins':'Склад значки (копия)','magnets':'Склад магниты (копия)','earrings':'Склад серьги  (копия)'}
SOURCE_TABS = {'keychains':'Склад брелки','pins':'Склад значки','magnets':'Склад магниты','earrings':'Склад серьги '}

def read_csv(path, head=None):
    if not os.path.exists(path) or os.path.getsize(path) < 5: return []
    with open(path, encoding='utf-8-sig', newline='') as f:
        sample = f.read(2048); f.seek(0)
        delim = ';' if sample.count(';') > sample.count(',') else ','
        return [dict(r) for r in csv.DictReader(f, delimiter=delim)]
def write_csv(path, rows, head):
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=head, extrasaction='ignore'); w.writeheader()
        for r in rows: w.writerow({k: r.get(k, '') for k in head})
def parse_dt(s):
    s = (s or '').strip()
    if not s: return None
    for fmt in ('%d.%m.%Y %H:%M:%S', '%d.%m.%Y %H:%M', '%d.%m.%Y'):
        try: return dt.datetime.strptime(s, fmt).replace(tzinfo=TZ)
        except ValueError: pass
    try:
        d = dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
        return (d.replace(tzinfo=TZ) if d.tzinfo is None else d).astimezone(TZ)
    except ValueError: return None
def fmt_dt(d): return d.astimezone(TZ).strftime('%d.%m.%Y %H:%M') if d else ''
def status(s): return (s or '').strip().lower()
def to_int(v):
    try: return int(float(str(v).replace(',', '.').replace(' ', '').replace('\xa0', '') or 0))
    except ValueError: return 0
def products():
    return {p['id']: p for p in json.load(open(os.path.join(SITE, 'products.json'), encoding='utf-8'))}
def write_reservations_js(rows):
    now = now_local()
    out = []
    for r in rows:
        exp = parse_dt(r.get('expiresAt'))
        if status(r.get('status')) == 'бронь' and exp and exp > now and to_int(r.get('qty')) > 0:
            out.append({'orderId': r['orderId'], 'productId': r['productId'], 'productName': r.get('productName',''),
                        'qty': to_int(r['qty']), 'status': 'бронь', 'expiresAt': exp.isoformat()})
    json.dump(out, open(os.path.join(SITE, 'reservations.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    open(os.path.join(SITE, 'reservations.js'), 'w', encoding='utf-8').write(
        f'// Сгенерировано tools/sync_reservations.py / process_orders.py {now:%d.%m.%Y %H:%M} из вкладки «Бронь». Только активные брони.\n'
        'window.RESERVATIONS = ' + json.dumps(out, ensure_ascii=False) + ';\n')
    return out
def order_rows_from_json(o):
    """Заявка с сайта (zayavka-*.json) → строка «Заказы» + строки «Бронь»."""
    t, c = o['totals'], o['contact']
    orow = {'orderId': o['id'], 'Дата выставления': fmt_dt(parse_dt(o['createdAt'])), 'Режим': o.get('modeName', ''),
            'Способ оплаты': o['payment']['label'], 'Счёт №': o['invoice']['number'], 'Клиент': c.get('name',''), 'Телефон': c.get('phone',''),
            'Email': c.get('email',''), 'Компания': c.get('company',''), 'Сумма товаров, ₽': t['total'], 'НДС / наценка, ₽': t.get('markup', 0),
            'К оплате, ₽': t.get('grand', t['total']), 'Бронь до': fmt_dt(parse_dt(o['reservation']['expiresAt'])), 'Статус': 'бронь',
            'Списано со склада': '', 'Комментарий': o.get('comment', '')}
    rrows = [{'orderId': o['id'], 'dateIssued': fmt_dt(parse_dt(o['createdAt'])), 'expiresAt': fmt_dt(parse_dt(o['reservation']['expiresAt'])),
              'productId': l['productId'], 'productName': l['productName'], 'category': l['category'], 'qty': l['qty'], 'status': 'бронь',
              'paymentMethod': o['payment']['label'], 'customer': c.get('company') or c.get('name',''), 'Строка склада': ' | '.join(l.get('stockRows') or []), 'Списано': ''}
             for l in o['reservation']['lines']]
    return orow, rrows
