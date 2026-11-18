"""
Приём заказов сайта «Сувенирка» в Яндекс Облаке (152-ФЗ: персональные данные хранятся в России).

  handler        — публичная HTTP-функция: POST заказа с сайта.
                   1) проверка  2) полный заказ → YDB  3) счёт PDF + 2 письма через smtp.mail.ru
                   4) заказ БЕЗ личных данных → Apps Script (брони, склад, статусы в Google-таблице).
  admin_handler  — закрытая функция (вызов только с IAM-токеном): schema / get / list / delete.

Секреты: MAILRU_APP_PASSWORD приходит из Lockbox как переменная окружения. В коде и в репозитории секретов нет.
"""
import base64, datetime as dt, hashlib, html, json, os, re, smtplib, ssl, time, urllib.parse
from email.message import EmailMessage
from email.utils import formataddr, make_msgid, formatdate

import requests
import ydb

VERSION = 'cloud-2026-11-18.1'
MSK = dt.timezone(dt.timedelta(hours=3))
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get('ALLOWED_ORIGINS', 'https://xyrma92-byte.github.io').split(',') if o.strip()]
SELLER_EMAIL = os.environ.get('SELLER_EMAIL', 'iptns@mail.ru')
SMTP_USER = os.environ.get('SMTP_USER', 'iptns@mail.ru')
SMTP_HOST = os.environ.get('SMTP_HOST', 'smtp.mail.ru')
SMTP_PORT = int(os.environ.get('SMTP_PORT', '465'))
SHOP_NAME = 'Сувенирка'
PHONE = '8 (964) 342-69-67'
TELEGRAM = 'https://t.me/+79643426967'
WHATSAPP = 'https://wa.me/79643426967'
APPS_SCRIPT_URL = os.environ.get('APPS_SCRIPT_URL', '')
SEND_CUSTOMER_EMAIL = os.environ.get('SEND_CUSTOMER_EMAIL', '1') == '1'
MAX_BODY = 1_500_000
HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------- YDB ----------------
_driver = None
_pool = None
SCHEMA = [
    """CREATE TABLE IF NOT EXISTS orders (
      id Utf8 NOT NULL, created_at Timestamp, updated_at Timestamp, status Utf8,
      order_type Utf8, mode Utf8, payment_type Utf8, payment_label Utf8, invoice_number Utf8,
      customer_name Utf8, phone Utf8, email Utf8, company Utf8, inn Utf8, requisites Utf8, city Utf8,
      delivery Json, items Json, totals Json, consents Json, reservation Json,
      comment Utf8, total Double, markup Double, grand Double,
      mail_customer Utf8, mail_seller Utf8, sheet_sync Utf8, client_ip_hash Utf8, raw Json,
      PRIMARY KEY (id))""",
    """CREATE TABLE IF NOT EXISTS consents (
      order_id Utf8 NOT NULL, accepted_at Timestamp, personal_data Bool, terms Bool, marketing Bool,
      docs_version Utf8, email Utf8, phone Utf8, PRIMARY KEY (order_id))""",
]


def pool():
    global _driver, _pool
    if _pool is None:
        _driver = ydb.Driver(endpoint=os.environ['YDB_ENDPOINT'], database=os.environ['YDB_DATABASE'],
                             credentials=ydb.iam.MetadataUrlCredentials())
        _driver.wait(timeout=10, fail_fast=True)
        _pool = ydb.QuerySessionPool(_driver)
    return _pool


def close_db():
    """Контейнер функции «замораживается» между вызовами — фоновые gRPC-потоки YDB после этого зависают.
    Поэтому соединение открывается на один вызов и закрывается в конце."""
    global _driver, _pool
    try:
        if _pool is not None:
            _pool.stop(timeout=3)
    except Exception as err:
        print('pool.stop', err)
    try:
        if _driver is not None:
            _driver.stop(timeout=3)
    except Exception as err:
        print('driver.stop', err)
    _driver = _pool = None


def q(sql, params=None):
    return with_timeout(lambda: _q(sql, params), float(os.environ.get('YDB_TIMEOUT', '12')))


def _q(sql, params=None):
    res = pool().execute_with_retries(sql, params or {}, retry_settings=ydb.RetrySettings(max_retries=3, max_session_acquire_timeout=10))
    rows = []
    for rs in res:
        rows.extend(rs.rows)
    return rows


def ensure_schema():
    for s in SCHEMA:
        q(s)


def ts(v):
    try:
        d = dt.datetime.fromisoformat(str(v).replace('Z', '+00:00'))
        if d.tzinfo is None:
            d = d.replace(tzinfo=dt.timezone.utc)
        return d
    except Exception:
        return dt.datetime.now(dt.timezone.utc)


U, D, J, T, B = ydb.PrimitiveType.Utf8, ydb.PrimitiveType.Double, ydb.PrimitiveType.Json, ydb.PrimitiveType.Timestamp, ydb.PrimitiveType.Bool


def p(v, t):
    return ydb.TypedValue(v, t)


def js(v):
    return json.dumps(v if v is not None else None, ensure_ascii=False)


def order_exists(oid):
    return bool(q('DECLARE $id AS Utf8; SELECT id FROM orders WHERE id = $id;', {'$id': p(oid, U)}))


def save_order(o, ip_hash):
    c = o.get('contact') or {}
    pay = o.get('payment') or {}
    inv = o.get('invoice') or {}
    t = o.get('totals') or {}
    now = dt.datetime.now(dt.timezone.utc)
    s = lambda v: str(v if v is not None else '')[:4000]
    num = lambda v: float(v or 0)
    params = {
        '$id': p(o['id'], U), '$created_at': p(ts(o.get('createdAt')), T), '$updated_at': p(now, T), '$status': p('бронь', U),
        '$order_type': p(s(o.get('type')), U), '$mode': p(s(o.get('modeName') or o.get('mode')), U),
        '$payment_type': p(s(pay.get('id')), U), '$payment_label': p(s(pay.get('label')), U), '$invoice_number': p(s(inv.get('number')), U),
        '$customer_name': p(s(c.get('name')), U), '$phone': p(s(c.get('phone')), U), '$email': p(s(c.get('email')), U),
        '$company': p(s(c.get('company')), U), '$inn': p(s(c.get('inn')), U), '$requisites': p(s(c.get('requisites')), U), '$city': p(s(c.get('city')), U),
        '$delivery': p(js(o.get('delivery')), J), '$items': p(js(o.get('items')), J), '$totals': p(js(t), J),
        '$consents': p(js(o.get('consents')), J), '$reservation': p(js(o.get('reservation')), J),
        '$comment': p(s(o.get('customerComment') if o.get('customerComment') is not None else o.get('comment')), U),
        '$total': p(num(t.get('total')), D), '$markup': p(num(t.get('markup')), D), '$grand': p(num(t.get('grand') or t.get('total')), D),
        '$ip': p(ip_hash, U), '$raw': p(js(o), J),
    }
    sql = '''
      DECLARE $id AS Utf8; DECLARE $created_at AS Timestamp; DECLARE $updated_at AS Timestamp; DECLARE $status AS Utf8;
      DECLARE $order_type AS Utf8; DECLARE $mode AS Utf8; DECLARE $payment_type AS Utf8; DECLARE $payment_label AS Utf8; DECLARE $invoice_number AS Utf8;
      DECLARE $customer_name AS Utf8; DECLARE $phone AS Utf8; DECLARE $email AS Utf8; DECLARE $company AS Utf8; DECLARE $inn AS Utf8;
      DECLARE $requisites AS Utf8; DECLARE $city AS Utf8; DECLARE $delivery AS Json; DECLARE $items AS Json; DECLARE $totals AS Json;
      DECLARE $consents AS Json; DECLARE $reservation AS Json; DECLARE $comment AS Utf8; DECLARE $total AS Double; DECLARE $markup AS Double;
      DECLARE $grand AS Double; DECLARE $ip AS Utf8; DECLARE $raw AS Json;
      INSERT INTO orders (id, created_at, updated_at, status, order_type, mode, payment_type, payment_label, invoice_number,
        customer_name, phone, email, company, inn, requisites, city, delivery, items, totals, consents, reservation,
        comment, total, markup, grand, client_ip_hash, raw)
      VALUES ($id, $created_at, $updated_at, $status, $order_type, $mode, $payment_type, $payment_label, $invoice_number,
        $customer_name, $phone, $email, $company, $inn, $requisites, $city, $delivery, $items, $totals, $consents, $reservation,
        $comment, $total, $markup, $grand, $ip, $raw);'''
    q(sql, params)
    cs = o.get('consents') or {}
    q('''DECLARE $id AS Utf8; DECLARE $at AS Timestamp; DECLARE $pd AS Bool; DECLARE $t AS Bool; DECLARE $m AS Bool;
         DECLARE $v AS Utf8; DECLARE $e AS Utf8; DECLARE $ph AS Utf8;
         UPSERT INTO consents (order_id, accepted_at, personal_data, terms, marketing, docs_version, email, phone)
         VALUES ($id, $at, $pd, $t, $m, $v, $e, $ph);''',
      {'$id': p(o['id'], U), '$at': p(ts(cs.get('acceptedAt') or o.get('createdAt')), T), '$pd': p(bool(cs.get('personalData')), B),
       '$t': p(bool(cs.get('terms')), B), '$m': p(bool(cs.get('marketing')), B), '$v': p(s(cs.get('docsVersion')), U),
       '$e': p(s(c.get('email')), U), '$ph': p(s(c.get('phone')), U)})


def update_status(oid, **kw):
    sets, params, decl = [], {'$id': p(oid, U), '$now': p(dt.datetime.now(dt.timezone.utc), T)}, ['DECLARE $id AS Utf8;', 'DECLARE $now AS Timestamp;']
    for k, v in kw.items():
        decl.append(f'DECLARE ${k} AS Utf8;')
        sets.append(f'{k} = ${k}')
        params['$' + k] = p(str(v)[:2000], U)
    q(' '.join(decl) + f' UPDATE orders SET {", ".join(sets)}, updated_at = $now WHERE id = $id;', params)


def with_timeout(fn, sec):
    import threading
    box = {}

    def run():
        try:
            box['r'] = fn()
        except BaseException as err:  # noqa
            box['e'] = err
    th = threading.Thread(target=run, daemon=True)
    th.start()
    th.join(sec)
    if th.is_alive():
        raise TimeoutError(f'YDB не ответила за {sec} с')
    if 'e' in box:
        raise box['e']
    return box.get('r')


# ---------------- Резерв: Object Storage (Россия, приватный бакет) ----------------
# Если YDB недоступна, полный заказ не теряется: он пишется JSON-файлом в приватный бакет (pending/<id>.json),
# а закрытая админ-функция потом переносит его в YDB (action=sync).
BUCKET = os.environ.get('BACKUP_BUCKET', '')
_ctx_token = None


def iam_token():
    if _ctx_token:
        return _ctx_token
    r = requests.get('http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token',
                     headers={'Metadata-Flavor': 'Google'}, timeout=3)
    return r.json()['access_token']


def s3(method, key, data=None, params=None):
    url = f'https://storage.yandexcloud.net/{BUCKET}/{urllib.parse.quote(key)}' if key else f'https://storage.yandexcloud.net/{BUCKET}'
    return requests.request(method, url, data=data, params=params, timeout=10,
                            headers={'X-YaCloud-SubjectToken': iam_token(), **({'Content-Type': 'application/json'} if data else {})})


def backup_exists(oid):
    return bool(BUCKET) and s3('HEAD', f'pending/{oid}.json').status_code == 200


def backup_save(o, ip_hash, reason):
    if not BUCKET:
        raise RuntimeError('BACKUP_BUCKET не задан')
    doc = {'order': o, 'ip_hash': ip_hash, 'saved_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'reason': str(reason)[:300]}
    r = s3('PUT', f'pending/{o["id"]}.json', json.dumps(doc, ensure_ascii=False).encode('utf-8'))
    if r.status_code != 200:
        raise RuntimeError(f'Object Storage HTTP {r.status_code}')


def backup_list():
    import xml.etree.ElementTree as ET
    r = s3('GET', '', params={'list-type': '2', 'prefix': 'pending/'})
    root = ET.fromstring(r.content)
    ns = {'s': root.tag.split('}')[0].strip('{')} if root.tag.startswith('{') else {}
    keys = [k.text for k in root.iter(('{%s}' % ns['s'] if ns else '') + 'Key')]
    return keys


# ---------------- Проверка ----------------
ID_RE = re.compile(r'^[A-ZА-Я]{1,6}-[0-9A-Za-z\-]{4,40}$')
EMAIL_RE = re.compile(r'^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$')


class Bad(Exception):
    pass


def validate(o):
    if not isinstance(o, dict):
        raise Bad('нет order')
    oid = str(o.get('id') or '')
    if not ID_RE.match(oid):
        raise Bad('неверный номер заказа')
    c = o.get('contact') or {}
    if not str(c.get('name') or '').strip():
        raise Bad('нет имени')
    if len(re.sub(r'\D', '', str(c.get('phone') or ''))) < 10:
        raise Bad('нет телефона')
    em = str(c.get('email') or '').strip()
    if em and not EMAIL_RE.match(em):
        raise Bad('неверный email')
    items = o.get('items') or []
    if not isinstance(items, list) or not items or len(items) > 500:
        raise Bad('нет товаров')
    for i in items:
        try:
            if float(i.get('qty') or 0) <= 0 or float(i.get('sum') or 0) < 0:
                raise Bad('неверное количество / сумма')
        except (TypeError, ValueError):
            raise Bad('неверное количество / сумма')
    t = o.get('totals') or {}
    try:
        grand = float(t.get('grand') or t.get('total') or 0)
    except (TypeError, ValueError):
        raise Bad('неверная сумма')
    if grand <= 0 or grand > 100_000_000:
        raise Bad('неверная сумма')
    cs = o.get('consents') or {}
    if not cs.get('personalData'):
        raise Bad('нет согласия на обработку ПД')
    for k in ('name', 'phone', 'email', 'company', 'inn', 'city'):
        if len(str(c.get(k) or '')) > 300:
            raise Bad('слишком длинное поле ' + k)
    return oid


# ---------------- Тексты писем (как в Code.gs 2026-11-17.6) ----------------
def fmt(v):
    return ts(v).astimezone(MSK).strftime('%d.%m.%Y %H:%M')


def rub(n):
    v = round(float(n or 0) * 100) / 100
    i, f = f'{abs(v):.2f}'.split('.')
    i = re.sub(r'\B(?=(\d{3})+(?!\d))', ' ', i)
    return ('−' if v < 0 else '') + i + ('' if f == '00' else ',' + f) + ' ₽'


def unit_short(u):
    return 'компл.' if u == 'комплект' else 'усл.' if u == 'услуга' else 'шт'


def item_status(i):
    if i.get('fee'):
        return 'разово, без скидки'
    if i.get('custom'):
        return 'свой дизайн, под заказ'
    a, b = float(i.get('inStockQty') or 0), float(i.get('madeToOrderQty') or 0)
    n = lambda x: str(int(x)) if x == int(x) else str(x)
    if a and b:
        return f'{n(a)} из наличия (бронь) + {n(b)} под заказ'
    if b:
        return 'под заказ'
    return 'из наличия (бронь)'


def items_list(o):
    out = []
    for i in o.get('items') or []:
        qn = float(i.get('qty') or 0)
        qs = str(int(qn)) if qn == int(qn) else str(qn)
        out.append((i.get('name') or '') + (f" ({i['categoryName']})" if i.get('categoryName') else '') + f' — {qs} {unit_short(i.get("unit"))}' +
                   (f', {rub(i["sum"])}' if i.get('sum') is not None else '') + ' — ' + item_status(i) +
                   (f'; референс: {i["link"]}' if i.get('custom') and i.get('link') else ''))
    return out


def delivery_line(o):
    d = o.get('delivery')
    if not d:
        return ''
    addr = ', '.join(str(x) for x in [d.get('postIndex'), d.get('city'), d.get('address')] if str(x or '').strip())
    return ' — '.join(x for x in [d.get('service') or '', addr] if x)


def e(v):
    return html.escape(str(v if v is not None else ''), quote=True)


def customer_mail(o, oid):
    inv, ct, tt, rs, d = o.get('invoice') or {}, o.get('contact') or {}, o.get('totals') or {}, o.get('reservation') or {}, o.get('delivery')
    num, total = inv.get('number') or oid, rub(tt.get('grand') or tt.get('total'))
    until = fmt(rs['expiresAt']) if rs.get('expiresAt') else ''
    hello = 'Добрый день' + (', ' + ct['name'] if ct.get('name') else '') + '!'
    pickup = bool(d) and bool(re.search('самовывоз', f"{d.get('payer') or ''} {d.get('service') or ''}", re.I))
    dlv = '' if not d else ('Получение: ' + delivery_line(o) + '.' if pickup else
                            'Доставка: ' + delivery_line(o) + '. Доставка оплачивается получателем при получении по тарифу службы, отправка из г. Павловск после оплаты заказа; трек-номер пришлём.')
    items = items_list(o)
    lines = rs.get('lines') or []
    res_txt = (f'Товар из наличия забронирован до {until} — оплатите, пожалуйста, до этого времени.' if until and lines
               else (f'Счёт действителен до {until}.' if until else ''))
    subject = f'Ваш заказ № {oid} — счёт № {num}'
    parts = [hello, '', f'Вы оформили заказ № {oid} на сумму {total}. Счёт № {num} во вложении (PDF).', res_txt, dlv, '',
             ('Состав заказа:\n' + '\n'.join('• ' + x for x in items)) if items else '', '',
             f'После оплаты, пожалуйста, пришлите чек (квитанцию / платёжку) любым удобным способом: ответом на это письмо, в Telegram ({TELEGRAM}) или в WhatsApp ({WHATSAPP}).',
             '', 'Спасибо за заказ!', f'{SHOP_NAME}, тел. {PHONE}']
    text = []
    for x in parts:
        if x == '' and (not text or text[-1] == ''):
            continue
        if x or (text and text[-1] != ''):
            text.append(x)
    a = lambda href, t: f'<a href="{e(href)}">{e(t)}</a>'
    res_html = (f'<p>Товар из наличия забронирован до <b>{e(until)}</b> — оплатите, пожалуйста, до этого времени.</p>' if until and lines
                else (f'<p>Счёт действителен до <b>{e(until)}</b>.</p>' if until else ''))
    body_html = ('<div style="font:15px/1.5 Arial,Helvetica,sans-serif;color:#111;max-width:640px">'
                 f'<p>{e(hello)}</p><p>Вы оформили заказ <b>№ {e(oid)}</b> на сумму <b>{e(total)}</b>. Счёт № {e(num)} — во вложении (PDF).</p>'
                 + res_html + (f'<p>{e(dlv)}</p>' if dlv else '') +
                 ('<p style="margin-bottom:4px"><b>Состав заказа:</b></p><ul style="margin-top:0;padding-left:20px">' + ''.join(f'<li>{e(x)}</li>' for x in items) + '</ul>' if items else '') +
                 f'<p>После оплаты, пожалуйста, пришлите чек (квитанцию / платёжку) любым удобным способом: ответом на это письмо, в {a(TELEGRAM, "Telegram")} или в {a(WHATSAPP, "WhatsApp")}.</p>'
                 f'<p>Спасибо за заказ!<br>{e(SHOP_NAME)}, тел. {e(PHONE)}</p></div>')
    return subject, '\n'.join(text).strip(), body_html


def seller_mail(o, oid):
    inv, ct, tt, rs, pay, d = (o.get('invoice') or {}, o.get('contact') or {}, o.get('totals') or {}, o.get('reservation') or {},
                               o.get('payment') or {}, o.get('delivery') or {})
    total = rub(tt.get('grand') or tt.get('total'))
    rows = [('Заказ', oid), ('Счёт', inv.get('number') or ''), ('Сумма к оплате', total), ('Способ оплаты', pay.get('label') or ''),
            ('Режим', o.get('modeName') or ''), ('Покупатель', ', '.join(x for x in [ct.get('company'), ct.get('name')] if x)),
            ('ИНН покупателя', ct.get('inn') or ''), ('Реквизиты', ct.get('requisites') or ''),
            ('Телефон', ct.get('phone') or ''), ('Почта', ct.get('email') or ''), ('Доставка', delivery_line(o)),
            ('Получатель', ', '.join(x for x in [d.get('recipientName'), d.get('recipientPhone')] if x)), ('Оплата доставки', d.get('payer') or ''),
            ('Комментарий', ' | '.join(x for x in [o.get('customerComment') if o.get('customerComment') is not None else o.get('comment'), d.get('comment')] if x)),
            ('Бронь до', fmt(rs['expiresAt']) if rs.get('expiresAt') else '')]
    rows = [r for r in rows if str(r[1] or '').strip()]
    items = items_list(o)
    subject = f'Новый заказ {oid} — {total}'
    tail = 'Счёт — во вложении. Заказ сохранён в базе Яндекс Облака. После оплаты поставьте в «Заказы» статус «оплачен».'
    text = '\n'.join(f'{k}: {v}' for k, v in rows) + (('\n\nСостав:\n' + '\n'.join('• ' + x for x in items)) if items else '') + '\n\n' + tail
    body_html = ('<div style="font:14px/1.45 Arial,Helvetica,sans-serif;color:#111;max-width:680px"><table style="border-collapse:collapse">' +
                 ''.join(f'<tr><td style="padding:3px 12px 3px 0;color:#555;vertical-align:top">{e(k)}</td><td style="padding:3px 0"><b>{e(v)}</b></td></tr>' for k, v in rows) +
                 '</table>' + ('<p style="margin-bottom:4px"><b>Состав:</b></p><ul style="margin-top:0;padding-left:20px">' + ''.join(f'<li>{e(x)}</li>' for x in items) + '</ul>' if items else '') +
                 f'<p>{e(tail)}</p></div>')
    return subject, text, body_html


# ---------------- Счёт PDF ----------------
FONT_CSS = '''<style>
@font-face { font-family: "Inv"; src: url("{R}"); }
@font-face { font-family: "Inv"; src: url("{B}"); font-weight: bold; }
body, td, th, p, div, h1, h3, small, b { font-family: "Inv"; }
@page { size: a4 portrait; margin: 1.4cm 1.2cm; }
body { max-width: none; margin: 0; padding: 0; font-size: 9pt; }
table { width: 100%; } td, th { padding: 3px 5px; }
.tot { width: 60%; margin-left: 40%; } .sign div { border-bottom: 1px solid #000; }
</style>'''


def _font(name):
    return os.path.join(HERE, 'fonts', name)


def _no_remote(uri, rel):
    # Никаких внешних ресурсов (защита от SSRF): разрешены только наши шрифты
    allowed = {_font('DejaVuSans.ttf'), _font('DejaVuSans-Bold.ttf')}
    return uri if uri in allowed else ''


def sanitize_invoice(h):
    h = str(h or '')
    h = re.sub(r'<div class="tools">[\s\S]*?</div>', '', h, flags=re.I)
    h = re.sub(r'<script[\s\S]*?</script>', '', h, flags=re.I)
    h = re.sub(r'<(img|link|iframe|object|embed|svg|video|audio|source|base|meta http-equiv)[^>]*>', '', h, flags=re.I)
    h = re.sub(r'url\s*\([^)]*\)', 'none', h, flags=re.I)
    h = re.sub(r'@import[^;]*;', '', h, flags=re.I)
    h = h.replace('<th>№</th><th>Товар</th><th>Кол-во</th><th>Ед.</th><th>Цена, ₽</th><th>Сумма, ₽</th>',
                  '<th style="width:5%">№</th><th style="width:47%">Товар</th><th style="width:11%">Кол-во</th><th style="width:8%">Ед.</th><th style="width:14%">Цена, ₽</th><th style="width:15%">Сумма, ₽</th>')
    h = h.replace('🖨', '').replace('🚚 ', '').replace('🚚', '')
    css = FONT_CSS.replace('{R}', _font('DejaVuSans.ttf')).replace('{B}', _font('DejaVuSans-Bold.ttf'))
    # наш CSS — после CSS сайта, чтобы шрифт с кириллицей перекрыл Arial
    if re.search(r'</head>', h, re.I):
        h = re.sub(r'</head>', css + '</head>', h, count=1, flags=re.I)
    else:
        h = css + h
    return h


def invoice_pdf(invoice_html, o, oid):
    if not invoice_html:
        return None, 'нет invoiceHtml'
    from io import BytesIO
    from xhtml2pdf import pisa
    buf = BytesIO()
    st = pisa.CreatePDF(sanitize_invoice(invoice_html), dest=buf, encoding='utf-8', link_callback=_no_remote)
    if st.err:
        return None, f'ошибка PDF: {st.err}'
    name = 'Счёт_' + re.sub(r'[\\/:*?"<>|\s]+', '_', str((o.get('invoice') or {}).get('number') or oid)) + '.pdf'
    data = buf.getvalue()
    return (name, data), f'{name} ({len(data)} байт)'


# ---------------- SMTP ----------------
def send_mails(o, oid, pdf):
    ct = o.get('contact') or {}
    pw = os.environ.get('MAILRU_APP_PASSWORD', '')
    out = {'customer': '', 'seller': ''}
    if not pw:
        return {'customer': 'нет пароля SMTP', 'seller': 'нет пароля SMTP'}
    msgs = []
    if not SEND_CUSTOMER_EMAIL:
        out['customer'] = 'выключено'
    elif not ct.get('email'):
        out['customer'] = 'нет email'
    else:
        subj, txt, hb = customer_mail(o, oid)
        msgs.append(('customer', ct['email'], SHOP_NAME, SELLER_EMAIL, subj, txt, hb))
    if SELLER_EMAIL:
        subj, txt, hb = seller_mail(o, oid)
        msgs.append(('seller', SELLER_EMAIL, SHOP_NAME + ' — заказы', ct.get('email') or SELLER_EMAIL, subj, txt, hb))
    if not msgs:
        return out
    try:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20, context=ssl.create_default_context()) as s:
            s.login(SMTP_USER, pw)
            for kind, to, from_name, reply_to, subj, txt, hb in msgs:
                m = EmailMessage()
                m['Subject'] = subj
                m['From'] = formataddr((from_name, SMTP_USER))
                m['To'] = to
                m['Reply-To'] = reply_to
                m['Date'] = formatdate(localtime=False)
                m['Message-ID'] = make_msgid(domain='mail.ru')
                m.set_content(txt)
                m.add_alternative(hb, subtype='html')
                if pdf:
                    m.add_attachment(pdf[1], maintype='application', subtype='pdf', filename=pdf[0])
                try:
                    refused = s.send_message(m)
                    out[kind] = ('отправлено: ' + to + ('' if pdf else ' (без PDF)')) if not refused else f'отклонено: {refused}'
                except smtplib.SMTPException as err:
                    out[kind] = f'ошибка: {err}'
    except Exception as err:
        for k in out:
            out[k] = out[k] or f'ошибка SMTP: {type(err).__name__}: {err}'
    for k in out:
        out[k] = out[k] or 'не отправлялось'
    return out


# ---------------- Google: только без личных данных ----------------
def depersonalize(o):
    """Только то, что нужно таблице для броней/склада/статусов. Без имени, телефона, почты, адреса, ИНН, реквизитов и комментариев."""
    pay, inv, t, rs, d, cs = (o.get('payment') or {}, o.get('invoice') or {}, o.get('totals') or {}, o.get('reservation') or {},
                              o.get('delivery') or {}, o.get('consents') or {})
    keep_item = ('id', 'name', 'category', 'categoryName', 'qty', 'unit', 'basePrice', 'unitPrice', 'sum', 'availability',
                 'inStockQty', 'madeToOrderQty', 'custom', 'fee', 'twoClasp')
    items = []
    for i in o.get('items') or []:
        x = {k: i[k] for k in keep_item if k in i}
        if i.get('custom'):
            x['description'] = str(i.get('description') or '')[:300]
        items.append(x)
    return {
        'id': o.get('id'), 'type': o.get('type'), 'typeName': o.get('typeName'), 'createdAt': o.get('createdAt'),
        'mode': o.get('mode'), 'modeName': o.get('modeName'),
        'payment': {k: pay.get(k) for k in ('id', 'label', 'markupRate', 'markupLabel') if k in pay},
        'invoice': {k: inv.get(k) for k in ('number', 'date', 'payUntil') if k in inv},
        'items': items, 'totals': t,
        'reservation': {'status': rs.get('status', 'бронь'), 'expiresAt': rs.get('expiresAt'),
                        'lines': [{k: l.get(k) for k in ('productId', 'productName', 'category', 'qty', 'stockRows')} for l in rs.get('lines') or []]},
        'delivery': {'serviceId': d.get('serviceId'), 'service': d.get('service'), 'kind': d.get('kind'), 'payer': d.get('payer')} if d else None,
        'consents': {k: cs.get(k) for k in ('personalData', 'terms', 'marketing', 'acceptedAt', 'docsVersion') if k in cs} if cs else None,
        'contact': {},  # пусто намеренно: личные данные — только в YDB
        'comment': '', 'customerComment': '',
        'storage': 'Яндекс Облако (YDB)',
    }


def push_to_sheet(o):
    if not APPS_SCRIPT_URL:
        return 'APPS_SCRIPT_URL не задан'
    body = json.dumps({'action': 'order', 'source': 'cloud', 'version': VERSION, 'order': depersonalize(o)}, ensure_ascii=False)
    try:
        r = requests.post(APPS_SCRIPT_URL, data=body.encode('utf-8'), headers={'Content-Type': 'text/plain;charset=utf-8'}, timeout=40)
        try:
            j = r.json()
        except ValueError:
            return f'HTTP {r.status_code}: не JSON'
        return json.dumps(j, ensure_ascii=False)[:1500]
    except Exception as err:
        return f'ошибка: {type(err).__name__}: {err}'


# ---------------- HTTP ----------------
def cors(event):
    h = {k.lower(): v for k, v in (event.get('headers') or {}).items()}
    origin = h.get('origin', '')
    allow = origin if origin in ALLOWED_ORIGINS else ALLOWED_ORIGINS[0]
    return {'Access-Control-Allow-Origin': allow, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400'}


def reply(event, code, obj):
    return {'statusCode': code, 'headers': {**cors(event), 'Content-Type': 'application/json; charset=utf-8'},
            'body': json.dumps(obj, ensure_ascii=False)}


def parse_body(event):
    raw = event.get('body') or ''
    if event.get('isBase64Encoded'):
        raw = base64.b64decode(raw).decode('utf-8', 'replace')
    if len(raw) > MAX_BODY:
        raise Bad('слишком большой запрос')
    raw = raw.strip()
    if raw.startswith('{'):
        return json.loads(raw)
    form = urllib.parse.parse_qs(raw)
    if 'payload' in form:
        return json.loads(form['payload'][0])
    raise Bad('пустой запрос')


def handler(event, context):
    try:
        return _handler(event, context)
    finally:
        close_db()


def _handler(event, context):
    method = (event.get('httpMethod') or 'GET').upper()
    if method == 'OPTIONS':
        return {'statusCode': 204, 'headers': cors(event), 'body': ''}
    if method == 'GET':
        return reply(event, 200, {'ok': True, 'version': VERSION, 'service': 'suvenirka-orders'})
    if method != 'POST':
        return reply(event, 405, {'ok': False, 'error': 'метод не поддерживается'})
    h = {k.lower(): v for k, v in (event.get('headers') or {}).items()}
    origin = h.get('origin', '')
    if origin and origin not in ALLOWED_ORIGINS and origin != 'null':
        return reply(event, 403, {'ok': False, 'error': 'чужой сайт'})
    oid = ''
    try:
        data = parse_body(event)
        o = data.get('order') if isinstance(data, dict) else None
        oid = validate(o)
        ip = (event.get('requestContext') or {}).get('identity', {}).get('sourceIp', '') or h.get('x-forwarded-for', '')
        ip_hash = hashlib.sha256(('suv:' + ip).encode()).hexdigest()[:16] if ip else ''
        global _ctx_token
        _ctx_token = (getattr(context, 'token', None) or {}).get('access_token') if context is not None else None
        stored, ydb_ok = 'ydb', True
        try:
            def ydb_store():
                ensure_schema_once()
                if order_exists(oid):
                    return 'dup'
                try:
                    save_order(o, ip_hash)
                except ydb.issues.PreconditionFailed:  # одновременный повтор (fetch + резервная форма)
                    return 'dup'
                return 'ok'
            r = with_timeout(ydb_store, float(os.environ.get('YDB_TIMEOUT', '12')))
            if r == 'dup':
                return reply(event, 200, {'ok': True, 'duplicate': True, 'id': oid, 'version': VERSION})
        except Exception as err:
            ydb_ok = False
            print('YDB недоступна, пишу в резерв Object Storage:', type(err).__name__, err)
            close_db()
            if backup_exists(oid):
                return reply(event, 200, {'ok': True, 'duplicate': True, 'id': oid, 'version': VERSION, 'stored': 'object-storage'})
            backup_save(o, ip_hash, f'{type(err).__name__}: {err}')  # если и это упало — 500, заказ не потерян молча
            stored = 'object-storage (резерв, YDB недоступна)'
        pdf, pdf_info = None, ''
        try:
            pdf, pdf_info = invoice_pdf(data.get('invoiceHtml'), o, oid)
        except Exception as err:
            pdf_info = f'ошибка PDF: {type(err).__name__}: {err}'
        mail = send_mails(o, oid, pdf)
        sheet = push_to_sheet(o)
        if ydb_ok:
            try:
                with_timeout(lambda: update_status(oid, mail_customer=mail['customer'] + ' | PDF: ' + pdf_info, mail_seller=mail['seller'], sheet_sync=sheet), 8)
            except Exception as err:
                print('update_status', err)
        print(json.dumps({'order': oid, 'stored': stored, 'pdf': pdf_info, 'mail': mail, 'sheet': sheet[:300]}, ensure_ascii=False))
        return reply(event, 200, {'ok': True, 'id': oid, 'version': VERSION, 'stored': stored, 'mail': mail, 'pdf': pdf_info, 'sheet': sheet})
    except Bad as err:
        return reply(event, 400, {'ok': False, 'error': str(err), 'id': oid})
    except Exception as err:
        print('ERROR', oid, type(err).__name__, err)
        return reply(event, 500, {'ok': False, 'error': 'внутренняя ошибка, заказ не сохранён', 'id': oid})


_schema_ok = False


def ensure_schema_once():
    global _schema_ok
    if not _schema_ok:
        ensure_schema()
        _schema_ok = True


# ---------------- Закрытая админ-функция (только с IAM-токеном) ----------------
def _row(r):
    d = {}
    for k in r.keys() if hasattr(r, 'keys') else []:
        v = r[k]
        d[k] = v.isoformat() if isinstance(v, dt.datetime) else (str(v) if isinstance(v, (bytes,)) else v)
    return d


def _safe(fn):
    try:
        return fn()
    except Exception as err:
        return f'ERR {type(err).__name__}: {err}'


def admin_handler(event, context):
    try:
        return _admin(event, context)
    finally:
        close_db()


def _admin(event, context):
    global _ctx_token
    _ctx_token = (getattr(context, 'token', None) or {}).get('access_token') if context is not None else None
    try:
        raw = event.get('body') or '{}'
        if event.get('isBase64Encoded'):
            raw = base64.b64decode(raw).decode()
        a = json.loads(raw) if isinstance(raw, str) else (raw or {})
    except Exception:
        a = {}
    act = a.get('action') or 'ping'
    try:
        if act == 'diag':
            import threading
            log, t0 = [], time.time()
            def step(name, fn, limit=15):
                box = {}
                th = threading.Thread(target=lambda: box.update(r=_safe(fn)), daemon=True); th.start(); th.join(limit)
                log.append(f'{name}: {round(time.time()-t0,2)}s ' + (str(box.get('r'))[:300] if 'r' in box else 'TIMEOUT'))
                return 'r' in box
            step('token', lambda: bool(ydb.iam.MetadataUrlCredentials().auth_metadata()))
            ok = step('driver', lambda: pool() and 'ok')
            if ok:
                step('select1', lambda: q('SELECT 1 AS x;')[0]['x'], 20)
                step('count_noretry', lambda: [r['n'] for rs in pool().execute_with_retries('SELECT COUNT(*) AS n FROM orders;', retry_settings=ydb.RetrySettings(max_retries=0)) for r in rs.rows], 20)
                def tbl():
                    sp = ydb.SessionPool(_driver, size=2)
                    try:
                        return sp.retry_operation_sync(lambda s: [r.n for r in s.transaction(ydb.SerializableReadWrite()).execute('SELECT COUNT(*) AS n FROM orders;', commit_tx=True)[0].rows], ydb.RetrySettings(max_retries=0))
                    finally:
                        sp.stop(timeout=2)
                step('count_table_service', tbl, 20)
                step('describe', lambda: [c.name for c in _driver.scheme_client.list_directory(os.environ['YDB_DATABASE']).children], 10)
            return {'statusCode': 200, 'body': json.dumps({'log': log}, ensure_ascii=False)}
        if act == 'backup_list':
            return {'statusCode': 200, 'body': json.dumps({'ok': True, 'pending': backup_list()}, ensure_ascii=False)}
        if act == 'backup_get':
            r = s3('GET', f'pending/{a.get("id")}.json')
            return {'statusCode': 200, 'body': json.dumps({'ok': r.status_code == 200, 'http': r.status_code, 'doc': r.json() if r.status_code == 200 else None}, ensure_ascii=False)}
        if act == 'backup_delete':
            r = s3('DELETE', f'pending/{a.get("id")}.json')
            left = s3('HEAD', f'pending/{a.get("id")}.json').status_code
            return {'statusCode': 200, 'body': json.dumps({'ok': r.status_code in (200, 204), 'http': r.status_code, 'head_after': left})}
        if act == 'sync':  # перенос резервных заказов из Object Storage в YDB
            done, errs = [], []
            for key in backup_list():
                try:
                    doc = s3('GET', key).json()
                    o = doc['order']

                    def mv():
                        ensure_schema()
                        if not order_exists(o['id']):
                            save_order(o, doc.get('ip_hash', ''))
                    with_timeout(mv, 15)
                    s3('DELETE', key)
                    done.append(o['id'])
                except Exception as err:
                    errs.append(f'{key}: {type(err).__name__}: {err}')
                    break
            return {'statusCode': 200, 'body': json.dumps({'ok': not errs, 'moved': done, 'errors': errs}, ensure_ascii=False)}
        if act == 'schema':
            ensure_schema()
            return {'statusCode': 200, 'body': json.dumps({'ok': True, 'schema': 'ok'})}
        if act == 'get':
            rows = q('DECLARE $id AS Utf8; SELECT * FROM orders WHERE id = $id;', {'$id': p(str(a.get('id')), U)})
            c = q('DECLARE $id AS Utf8; SELECT * FROM consents WHERE order_id = $id;', {'$id': p(str(a.get('id')), U)})
            return {'statusCode': 200, 'body': json.dumps({'ok': True, 'orders': [_row(r) for r in rows], 'consents': [_row(r) for r in c]}, ensure_ascii=False, default=str)}
        if act == 'list':
            rows = q('SELECT id, created_at, status, payment_type, grand, mail_customer, mail_seller FROM orders ORDER BY created_at DESC LIMIT 50;')
            return {'statusCode': 200, 'body': json.dumps({'ok': True, 'orders': [_row(r) for r in rows]}, ensure_ascii=False, default=str)}
        if act == 'count':
            rows = q('SELECT COUNT(*) AS n FROM orders;')
            return {'statusCode': 200, 'body': json.dumps({'ok': True, 'n': rows[0]['n'] if rows else 0})}
        if act == 'delete':
            oid = str(a.get('id') or '')
            q('DECLARE $id AS Utf8; DELETE FROM orders WHERE id = $id;', {'$id': p(oid, U)})
            q('DECLARE $id AS Utf8; DELETE FROM consents WHERE order_id = $id;', {'$id': p(oid, U)})
            left = q('DECLARE $id AS Utf8; SELECT COUNT(*) AS n FROM orders WHERE id = $id;', {'$id': p(oid, U)})
            if BUCKET:
                s3('DELETE', f'pending/{oid}.json')
            return {'statusCode': 200, 'body': json.dumps({'ok': True, 'deleted': oid, 'left': left[0]['n'] if left else None})}
        return {'statusCode': 200, 'body': json.dumps({'ok': True, 'version': VERSION})}
    except Exception as err:
        return {'statusCode': 500, 'body': json.dumps({'ok': False, 'error': f'{type(err).__name__}: {err}'}, ensure_ascii=False)}
