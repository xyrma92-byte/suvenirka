#!/usr/bin/env python3
"""Статистика рассылки КП.
  python3 stats.py                  # за вчера (МСК) + итог
  python3 stats.py --day 2026-11-18
  python3 stats.py --total          # только итог по всем дням
Источники: журнал отправок и события (открытия/клики) в бакете Яндекс Облака, ящик iptns@mail.ru (ответы и недоставки,
только чтение) через закрытую функцию suvenirka-outreach. Открытия приблизительные: mail.ru и Gmail грузят картинки через свои прокси."""
import argparse, csv, datetime as dt, json, os, re, subprocess, sys, urllib.parse, urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
B = 'https://storage.yandexcloud.net/suvenirka-orders-backup-b1gofs'
OUTREACH_FN = 'https://functions.yandexcloud.net/d4eksiiskc7v0jpt5mrv'
START = '2026-11-18'
SELF = 'iptns@mail.ru'
MSK = dt.timezone(dt.timedelta(hours=3))
PUBLIC = {'mail.ru', 'gmail.com', 'yandex.ru', 'ya.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'rambler.ru', 'internet.ru', 'icloud.com', 'outlook.com', 'hotmail.com', 'yandex.com', 'googlemail.com'}

ap = argparse.ArgumentParser()
ap.add_argument('--day'); ap.add_argument('--total', action='store_true'); ap.add_argument('--json', action='store_true')
a = ap.parse_args()
day = None if a.total else (a.day or (dt.datetime.now(MSK).date() - dt.timedelta(days=1)).isoformat())

tok = subprocess.check_output([os.path.expanduser('~/yandex-cloud/bin/yc'), 'iam', 'create-token'], text=True).strip()
H = {'X-YaCloud-SubjectToken': tok}


def get(url, data=None, headers=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers=headers or H)
    return urllib.request.urlopen(req, timeout=timeout).read()


def list_keys(prefix):
    keys, token = [], None
    while True:
        p = {'list-type': '2', 'prefix': prefix, 'max-keys': '1000', **({'continuation-token': token} if token else {})}
        x = get(B + '?' + urllib.parse.urlencode(p)).decode()
        keys += re.findall(r'<Key>([^<]+)</Key>', x)
        m = re.search(r'<NextContinuationToken>([^<]+)</NextContinuationToken>', x)
        if not m:
            return keys
        token = m.group(1)


def msk_day(iso):
    d = dt.datetime.fromisoformat(str(iso).replace('Z', '+00:00'))
    if d.tzinfo is None:
        d = d.replace(tzinfo=MSK)
    return d.astimezone(MSK).date().isoformat()


# 1) отправки (кэш, записи не меняются)
cache_f = os.path.join(HERE, '.sent_cache.json')
cache = json.load(open(cache_f)) if os.path.exists(cache_f) else {}
for k in list_keys('outreach/sent/'):
    if k not in cache:
        cache[k] = json.loads(get(f'{B}/{urllib.parse.quote(k)}'))
json.dump(cache, open(cache_f, 'w'), ensure_ascii=False)
queue = list(csv.DictReader(open(os.path.join(HERE, 'queue.csv'), encoding='utf-8-sig')))
qname = {r['email']: r['name'] for r in queue}
sent = [r for r in cache.values() if r.get('status') == 'отправлено' and r['email'] != SELF]
import hashlib
rid2email = {hashlib.sha256(r['email'].lower().encode()).hexdigest()[:10]: r['email'] for r in sent}
self_rid = hashlib.sha256(SELF.encode()).hexdigest()[:10]
sent_by = {r['email']: r for r in sent}
tracked = {r['email'] for r in sent if r.get('rid')}

# 2) события: outreach/events/<день>/<тип>~<rid>~<ссылка>~<кампания>~<мс>~<rand>
events = []
for k in list_keys('outreach/events/'):
    parts = k.split('/')[-1].split('~')
    if len(parts) < 6 or parts[1] == self_rid:
        continue
    t = dt.datetime.fromtimestamp(int(parts[4]) / 1000, dt.timezone.utc)
    events.append({'kind': parts[0], 'rid': parts[1], 'link': parts[2], 'email': rid2email.get(parts[1]), 'day': msk_day(t.isoformat())})

# 3) ящик: ответы и недоставки
imap = json.loads(get(OUTREACH_FN, json.dumps({'action': 'imap_scan', 'since': START}).encode(),
                      {'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'}, timeout=180))
sent_domains = {e.split('@')[1]: e for e in sent_by if e.split('@')[1] not in PUBLIC}
bounces, replies = {}, []
for m in imap.get('messages', []):
    if m['kind'] == 'bounce':
        for e in m.get('bounce_for') or []:
            if e in sent_by:
                bounces[e] = {'day': msk_day(m['date']), 'status': m.get('status', '')}
        continue
    frm = m['from']
    who = frm if frm in sent_by else sent_domains.get(frm.split('@')[-1])
    if who and frm != SELF:
        replies.append({'email': who, 'from': frm, 'subject': m['subject'], 'day': msk_day(m['date']),
                        'folder': 'Спам' if m['folder'] == '&BCEEPwQwBDw-' else m['folder']})


def block(title, f):
    s = [r for r in sent if f(msk_day(r['time']))]
    b = {e: v for e, v in bounces.items() if f(v['day'])}
    ev = [e for e in events if e['email'] and f(e['day'])]
    opens = {e['email'] for e in ev if e['kind'] == 'open'}
    cs = {e['email'] for e in ev if e['kind'] == 'click' and e['link'] == 'site'}
    co = {e['email'] for e in ev if e['kind'] == 'click' and e['link'] == 'ozon'}
    rp = [r for r in replies if f(r['day'])]
    print(f'\n=== {title} ===')
    print(f'Отправлено: {len(s)}  | доставлено: {len(s) - len([e for e in b if e in {x["email"] for x in s}]) if s else "—"}  | недоставки: {len(b)}')
    print(f'Открыли (уник.): {len(opens)}  | перешли на сайт: {len(cs)}  | на Ozon: {len(co)}  | ответили: {len({r["email"] for r in rp})}')
    if b:
        print('Недоставки: ' + ', '.join(f'{qname.get(e, e)} <{e}> {v["status"]}' for e, v in b.items()))
    if cs or co:
        print('Перешли: ' + ', '.join(f'{qname.get(e, e)} ({"сайт" if e in cs else ""}{"+" if e in cs and e in co else ""}{"Ozon" if e in co else ""})' for e in sorted(cs | co)))
    if opens:
        print('Открыли: ' + ', '.join(qname.get(e, e) for e in sorted(opens)))
    for r in rp:
        print(f'Ответ: {qname.get(r["email"], r["email"])} — {r["from"]} — «{r["subject"]}» [{r["folder"]}]')


if day:
    block(f'За {day} (МСК)', lambda d: d == day)
days = sorted({msk_day(r['time']) for r in sent} | {e['day'] for e in events} | {r['day'] for r in replies})
print('\n=== По дням (МСК) ===')
print('день        отпр  недост  откр  сайт  ozon  ответы')
for d in days:
    s = sum(msk_day(r['time']) == d for r in sent)
    bb = sum(v['day'] == d for v in bounces.values())
    ev = [e for e in events if e['email'] and e['day'] == d]
    print(f'{d}  {s:4}  {bb:6}  {len({e["email"] for e in ev if e["kind"] == "open"}):4}  '
          f'{len({e["email"] for e in ev if e["kind"] == "click" and e["link"] == "site"}):4}  {len({e["email"] for e in ev if e["kind"] == "click" and e["link"] == "ozon"}):4}  '
          f'{len({r["email"] for r in replies if r["day"] == d}):6}')
block('Итого с начала рассылки', lambda d: True)
left = [r for r in queue if r['email'] not in sent_by]
print(f'\nОсталось в очереди: {len(left)} из {len(queue)}.  Писем с трекингом (пиксель/ссылки): {len(tracked)} из {len(sent)}.')
if any(r['folder'] == 'Спам' for r in replies):
    print('⚠ Есть ответы в папке «Спам» — проверь её в почте.')
