#!/usr/bin/env python3
"""Отправка очередной пачки КП через закрытую функцию suvenirka-outreach.
  python3 run_batch.py --size 50            # только показать, кому уйдёт (dry run в облаке)
  python3 run_batch.py --size 50 --send     # отправить
Уже отправленные пропускаются (журнал в бакете + sent_log.csv здесь)."""
import argparse, csv, json, os, subprocess, sys, datetime as dt
import urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'https://functions.yandexcloud.net/d4eksiiskc7v0jpt5mrv'
ap = argparse.ArgumentParser(); ap.add_argument('--size', type=int, default=50); ap.add_argument('--send', action='store_true')
ap.add_argument('--pause-min', type=float, default=2); ap.add_argument('--pause-max', type=float, default=4)
a = ap.parse_args()
if a.size > 60: sys.exit('не больше 60 за вызов')
log = os.path.join(HERE, 'sent_log.csv')
done = set()
if os.path.exists(log):
    done = {r['email'] for r in csv.DictReader(open(log, encoding='utf-8')) if r['status'] in ('отправлено', 'пропуск')}
tok = subprocess.check_output([os.path.expanduser('~/yandex-cloud/bin/yc'), 'iam', 'create-token'], text=True).strip()


def call(obj, timeout=700):
    req = urllib.request.Request(URL, data=json.dumps(obj, ensure_ascii=False).encode(),
                                 headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=timeout))


# Стоп-лист: недоставки и ответы «нет» из ящика → бакет (outreach/suppress/) + suppression.csv здесь
sup_f = os.path.join(HERE, 'suppression.csv')
sup = {r['email']: r for r in csv.DictReader(open(sup_f, encoding='utf-8'))} if os.path.exists(sup_f) else {}
try:
    scan = call({'action': 'imap_scan', 'since': '2026-11-18'}, timeout=180)
    sent_set = {r['email'] for r in csv.DictReader(open(log, encoding='utf-8'))} if os.path.exists(log) else set()
    new = []
    for m in scan.get('messages', []):
        if m['kind'] == 'bounce':
            for e in m.get('bounce_for') or []:
                if e in sent_set and e not in sup:
                    new.append({'email': e, 'reason': 'недоставка ' + (m.get('status') or '')})
        elif m.get('says_no') and m['from'] not in sup and m['from'] != 'iptns@mail.ru':
            new.append({'email': m['from'], 'reason': 'ответил «нет»: ' + m['subject'][:80]})
    new = list({x['email']: x for x in new}.values())
    if new:
        call({'action': 'suppress', 'items': new}, timeout=60)
        for x in new:
            sup[x['email']] = x
        print('В стоп-лист добавлено:', ', '.join(x['email'] + ' (' + x['reason'] + ')' for x in new))
    with open(sup_f, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['email', 'reason'], extrasaction='ignore'); w.writeheader(); w.writerows(sup.values())
except Exception as err:
    print('⚠ стоп-лист не обновлён (ящик недоступен):', err, '— функция всё равно пропустит адреса, уже внесённые в стоп-лист')
q = [r for r in csv.DictReader(open(os.path.join(HERE, 'queue.csv'), encoding='utf-8-sig')) if r['email'] not in done and r['email'] not in sup][:a.size]
if not q: sys.exit('очередь пуста')
body = json.dumps({'recipients': [{'email': r['email'], 'name': r['subject_name']} for r in q], 'dry_run': not a.send,
                   'pause_min': a.pause_min, 'pause_max': a.pause_max}, ensure_ascii=False).encode()
res = call(json.loads(body))
print(json.dumps(res['summary'], ensure_ascii=False))
for r in res['results']:
    print(r['status'], r['email'], r.get('smtp_code', ''), r.get('reason', '') or r.get('smtp_resp', '')[:80])
if a.send:
    new = not os.path.exists(log)
    with open(log, 'a', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['email', 'name', 'time', 'status', 'smtp_code', 'smtp_resp', 'reason'], extrasaction='ignore')
        if new: w.writeheader()
        w.writerows(res['results'])
