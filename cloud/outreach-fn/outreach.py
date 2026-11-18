"""
Рассылка КП (закрытая функция, вызов только с IAM-токеном).
POST {"recipients": [{"email": "...", "name": "..."}], "pause_min": 2, "pause_max": 4, "dry_run": false, "force": false}
Одна SMTP-сессия smtp.mail.ru:465, письмо HTML + текст, вложение kp.pdf.
Журнал: бакет BUCKET, outreach/sent/<sha>.json (по нему пропускаются уже отправленные), outreach/runs/<время>.json.
"""
import datetime as dt, hashlib, html, json, os, random, re, smtplib, ssl, time, urllib.parse
from email.message import EmailMessage
from email.utils import formataddr, make_msgid, formatdate
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
SMTP_USER = os.environ.get('SMTP_USER', 'iptns@mail.ru')
FROM_NAME = os.environ.get('FROM_NAME', 'Никита')
BUCKET = os.environ.get('BACKUP_BUCKET', '')
SITE = 'https://xyrma92-byte.github.io/suvenirka/'
OZON = 'https://ozon.ru/s/ip-taran-2983954'
TG, WA = 'https://t.me/+79643426967', 'https://wa.me/79643426967'
SUBJECT = 'Мерч из настоящего металла оптом — для {Название}'
EMAIL_RE = re.compile(r'^[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9.\-]{1,190}\.[A-Za-z]{2,24}$')
_token = None


def token():
    if _token:
        return _token
    r = requests.get('http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token', headers={'Metadata-Flavor': 'Google'}, timeout=3)
    return r.json()['access_token']


def s3(method, key, data=None):
    return requests.request(method, f'https://storage.yandexcloud.net/{BUCKET}/{urllib.parse.quote(key)}', data=data, timeout=10,
                            headers={'X-YaCloud-SubjectToken': token(), **({'Content-Type': 'application/json'} if data else {})})


TRACK = os.environ.get('TRACK_URL', '')  # публичная функция suvenirka-orders (?t=o / ?t=c)
CAMPAIGN = os.environ.get('CAMPAIGN', 'kp_metal_2026_11')


def rid_for(email):
    return hashlib.sha256(email.strip().lower().encode()).hexdigest()[:10]


def utm_site(rid):
    return SITE + '?' + urllib.parse.urlencode({'utm_source': 'email', 'utm_medium': 'kp', 'utm_campaign': CAMPAIGN, 'utm_content': rid})


def sup_key(email):
    return 'outreach/suppress/' + hashlib.sha256(email.strip().lower().encode()).hexdigest()[:24] + '.json'


def key_for(email):
    return 'outreach/sent/' + hashlib.sha256(email.strip().lower().encode()).hexdigest()[:24] + '.json'


def build(email, name):
    body = open(os.path.join(HERE, 'body.txt'), encoding='utf-8').read().replace('{Название}', name)
    e = lambda s: html.escape(s, quote=True)
    rid = rid_for(email)
    q = lambda **kw: TRACK + '?' + urllib.parse.urlencode({**kw, 'r': rid, 'c': CAMPAIGN})
    site_href = q(t='c', l='site') if TRACK else utm_site(rid)
    ozon_href = q(t='c', l='ozon') if TRACK else OZON
    # текст: ссылки после фраз (сайт с UTM); HTML: ссылки спрятаны в слова и идут через трекинг-редирект
    text = (body.replace('можно на нашем сайте.', f'можно на нашем сайте: {utm_site(rid)}')
                .replace('в нашем магазине на Ozon.', f'в нашем магазине на Ozon: {OZON}'))
    paras = []
    for block in body.strip().split('\n\n'):
        h = '<br>'.join(e(x) for x in block.split('\n'))
        h = h.replace('на нашем сайте', f'<a href="{e(site_href)}">на нашем сайте</a>')
        h = h.replace('в нашем магазине на Ozon', f'<a href="{e(ozon_href)}">в нашем магазине на Ozon</a>')
        h = h.replace('в Telegram или WhatsApp:', f'в <a href="{TG}">Telegram</a> или <a href="{WA}">WhatsApp</a>:')
        h = h.replace(e(SMTP_USER), f'<a href="mailto:{SMTP_USER}">{SMTP_USER}</a>')
        h = h.replace('настоящего металла', '<b>настоящего металла</b>', 1)
        if block.startswith('Если неактуально'):
            paras.append(f'<p style="font-size:12px;color:#888;margin-top:18px">{h}</p>')
        else:
            paras.append(f'<p>{h}</p>')
    pixel = f'<img src="{e(q(t="o"))}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">' if TRACK else ''
    hb = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:640px">' + ''.join(paras) + pixel + '</div>'
    m = EmailMessage()
    m['Subject'] = SUBJECT.replace('{Название}', name)
    m['From'] = formataddr((FROM_NAME, SMTP_USER))
    m['To'] = email
    m['Reply-To'] = SMTP_USER
    m['Date'] = formatdate(localtime=False)
    m['Message-ID'] = make_msgid(domain='mail.ru')
    m.set_content(text)
    m.add_alternative(hb, subtype='html')
    with open(os.path.join(HERE, 'kp.pdf'), 'rb') as f:
        m.add_attachment(f.read(), maintype='application', subtype='pdf', filename='КП_мерч_из_металла.pdf')
    return m


def handler(event, context):
    global _token
    _token = (getattr(context, 'token', None) or {}).get('access_token') if context is not None else None
    try:
        raw = event.get('body') or '{}'
        if event.get('isBase64Encoded'):
            import base64
            raw = base64.b64decode(raw).decode('utf-8')
        a = json.loads(raw)
    except Exception:
        return {'statusCode': 400, 'body': json.dumps({'ok': False, 'error': 'не JSON'})}
    if a.get('action') == 'suppress':  # {"action":"suppress","items":[{"email":..,"reason":..}]}
        done = []
        for it in a.get('items') or []:
            e = str(it.get('email') or '').strip().lower()
            if EMAIL_RE.match(e):
                s3('PUT', sup_key(e), json.dumps({'email': e, 'reason': str(it.get('reason') or '')[:200],
                                                  'time': dt.datetime.now(dt.timezone.utc).isoformat()}, ensure_ascii=False).encode())
                done.append(e)
        return {'statusCode': 200, 'body': json.dumps({'ok': True, 'suppressed': done}, ensure_ascii=False)}
    if a.get('action') == 'imap_scan':
        return {'statusCode': 200, 'body': json.dumps(imap_scan(a.get('since'), a.get('folders')), ensure_ascii=False, default=str)}
    recips = a.get('recipients') or []
    if not isinstance(recips, list) or len(recips) > int(os.environ.get('MAX_PER_CALL', '60')):
        return {'statusCode': 400, 'body': json.dumps({'ok': False, 'error': 'список пуст или больше лимита на вызов'})}
    pmin, pmax = float(a.get('pause_min', 2)), float(a.get('pause_max', 4))
    dry, force = bool(a.get('dry_run')), bool(a.get('force'))
    run_at = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    results, smtp, stop = [], None, None
    try:
        for i, r in enumerate(recips):
            email, name = str(r.get('email') or '').strip(), str(r.get('name') or '').strip()
            rec = {'email': email, 'name': name, 'time': dt.datetime.now(dt.timezone.utc).isoformat()}
            if stop:
                rec.update(status='не отправлено', reason=stop); results.append(rec); continue
            if not EMAIL_RE.match(email) or not name:
                rec.update(status='пропуск', reason='неверный email или нет названия'); results.append(rec); continue
            k = key_for(email)
            if s3('HEAD', sup_key(email)).status_code == 200:  # стоп-лист: «нет» / недоставка — даже с force
                rec.update(status='пропуск', reason='в стоп-листе (ответил «нет» или недоставка)'); results.append(rec); continue
            if not force and s3('HEAD', k).status_code == 200:
                rec.update(status='пропуск', reason='уже отправлено ранее'); results.append(rec); continue
            if dry:
                rec.update(status='dry_run', subject=SUBJECT.replace('{Название}', name)); results.append(rec); continue
            try:
                if smtp is None:
                    smtp = smtplib.SMTP_SSL('smtp.mail.ru', 465, timeout=30, context=ssl.create_default_context())
                    smtp.login(SMTP_USER, os.environ['MAILRU_APP_PASSWORD'])
                elif results and any(x.get('status') == 'отправлено' for x in results):
                    time.sleep(random.uniform(pmin, pmax))
                m = build(email, name)
                code, resp = smtp.mail(SMTP_USER)
                if code != 250:
                    raise smtplib.SMTPSenderRefused(code, resp, SMTP_USER)
                code, resp = smtp.rcpt(email)
                if code not in (250, 251):
                    smtp.rset()
                    rec.update(status='отклонён адрес', smtp_code=code, smtp_resp=resp.decode(errors='replace')[:200]); results.append(rec)
                    continue
                code, resp = smtp.data(m.as_bytes())
                rec.update(status='отправлено' if code == 250 else 'ошибка', rid=rid_for(email), campaign=CAMPAIGN, smtp_code=code, smtp_resp=resp.decode(errors='replace')[:200],
                           message_id=m['Message-ID'], time=dt.datetime.now(dt.timezone.utc).isoformat())
                if code == 250:
                    s3('PUT', k, json.dumps(rec, ensure_ascii=False).encode())
            except smtplib.SMTPResponseException as err:
                rec.update(status='ошибка', smtp_code=err.smtp_code, smtp_resp=str(err.smtp_error)[:200])
                if err.smtp_code in (421, 450, 451, 452, 454, 550, 554) and 'rcpt' not in str(err).lower():
                    stop = f'остановлено после ошибки SMTP {err.smtp_code}'  # лимит/блок — не долбим дальше
            except Exception as err:
                rec.update(status='ошибка', smtp_resp=f'{type(err).__name__}: {err}'[:200])
                stop = 'остановлено: обрыв соединения'
            results.append(rec)
    finally:
        try:
            if smtp is not None:
                smtp.quit()
        except Exception:
            pass
    summary = {}
    for x in results:
        summary[x['status']] = summary.get(x['status'], 0) + 1
    out = {'ok': True, 'run': run_at, 'summary': summary, 'results': results, 'dry_run': dry}
    if BUCKET and not dry:
        try:
            s3('PUT', f'outreach/runs/{run_at}.json', json.dumps(out, ensure_ascii=False).encode())
        except Exception as err:
            out['log_error'] = str(err)
    return {'statusCode': 200, 'body': json.dumps(out, ensure_ascii=False)}


# ---------------- Ответы и недоставки: чтение ящика только на чтение (EXAMINE + BODY.PEEK, флаги не меняются) ----------------
def _dec(v):
    from email.header import decode_header, make_header
    try:
        return str(make_header(decode_header(v or '')))
    except Exception:
        return v or ''


NO_RE = re.compile(r'^\W*(нет|не\s+актуально|неактуально|не\s+интересно|неинтересно|не\s+надо|не\s+пишите|отпишите|удалите|no|unsubscribe|stop|стоп)\b', re.I)


def says_no(M, num):
    """Первые строки ответа (до цитаты) начинаются с «нет» / «неактуально» / «отпишите» и т. п."""
    import email as em
    try:
        typ, d = M.fetch(num, '(BODY.PEEK[]<0.300000>)')
        raw = next((p[1] for p in d if isinstance(p, tuple)), b'')
        msg = em.message_from_bytes(raw)
        text = ''
        for part in msg.walk():
            if part.get_content_type() in ('text/plain', 'text/html') and not part.get_filename():
                t = part.get_payload(decode=True) or b''
                t = t.decode(part.get_content_charset() or 'utf-8', 'replace')
                if part.get_content_type() == 'text/html':
                    t = re.sub(r'<(br|p|div)[^>]*>', '\n', t, flags=re.I)
                    t = html.unescape(re.sub(r'<[^>]+>', '', t))
                text = t
                if part.get_content_type() == 'text/plain':
                    break
        own = []
        for line in text.splitlines():
            l = line.strip()
            if l.startswith('>') or re.search(r'(написал|wrote|-----\s*original|Отправлено из|Пересылаемое)', l, re.I):
                break
            if l:
                own.append(l)
        head = ' '.join(own[:3])[:300]
        return bool(NO_RE.search(head)) or bool(re.search(r'(не\s+актуальн|неактуальн|не\s+интерес|отпишите|не\s+пишите)', head, re.I))
    except Exception:
        return False


def imap_scan(since=None, folders=None):
    import imaplib, email as em
    from email.utils import parseaddr, parsedate_to_datetime
    since_d = dt.date.fromisoformat(since) if since else dt.date.today() - dt.timedelta(days=7)
    out = {'ok': True, 'since': since_d.isoformat(), 'messages': [], 'folders': []}
    M = imaplib.IMAP4_SSL('imap.mail.ru', 993, timeout=30)
    try:
        M.login(SMTP_USER, os.environ['MAILRU_APP_PASSWORD'])
        typ, lst = M.list()
        names = []
        for raw in lst or []:
            line = raw.decode(errors='replace')
            mm = re.search(r'\(([^)]*)\) "[^"]*" (.+)$', line)
            if mm:
                names.append((mm.group(1), mm.group(2).strip().strip('"')))
        want = folders or ['INBOX']
        if not folders:
            # Спам (&BCEEPwQwBDw- = «Спам» в IMAP-кодировке) и автопапки mail.ru внутри «Входящих»
            want += [n for fl, n in names if '\\Junk' in fl or n in ('Spam', 'Junk', '&BCEEPwQwBDw-') or n.startswith('INBOX/')]
        out['folders'] = want
        out['all_folders'] = [n for fl, n in names]
        crit = '(SINCE "%s")' % since_d.strftime('%d-%b-%Y')
        for f in want:
            typ, _ = M.select('"%s"' % f, readonly=True)  # EXAMINE: не помечаем прочитанным
            if typ != 'OK':
                continue
            typ, data = M.search(None, crit)
            for num in (data[0].split() if data and data[0] else [])[-500:]:
                typ, d = M.fetch(num, '(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE IN-REPLY-TO REFERENCES CONTENT-TYPE)] BODY.PEEK[TEXT]<0.20000>)')
                hdr, txt = b'', b''
                for part in d:
                    if isinstance(part, tuple):
                        if b'HEADER' in part[0]:
                            hdr = part[1]
                        else:
                            txt = part[1]
                h = em.message_from_bytes(hdr)
                frm = parseaddr(_dec(h.get('From')))[1].lower()
                subj = _dec(h.get('Subject'))
                try:
                    date = parsedate_to_datetime(h.get('Date')).isoformat()
                except Exception:
                    date = h.get('Date')
                t = txt.decode('utf-8', 'replace')
                bounce = (frm.startswith(('mailer-daemon', 'postmaster')) or 'delivery-status' in (h.get('Content-Type') or '').lower()
                          or re.search(r'(undeliver|delivery status|не доставлен|недоставлен|returned mail|failure notice)', subj, re.I))
                rec = {'folder': f, 'from': frm, 'subject': subj[:200], 'date': date,
                       'kind': 'bounce' if bounce else ('reply' if re.search(r'(^re:|^ответ|Мерч из настоящего металла)', subj, re.I) or h.get('In-Reply-To') else 'other')}
                if rec['kind'] == 'reply' and not bounce:
                    rec['says_no'] = says_no(M, num)
                if bounce:
                    fr = re.findall(r'(?:Final-Recipient|Original-Recipient):\s*rfc822;\s*<?([^\s>]+)', t, re.I)
                    rec['bounce_for'] = sorted({x.lower() for x in fr}) or sorted({x.lower() for x in re.findall(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}', t)
                                                                               if not x.lower().startswith(('mailer-daemon', 'postmaster')) and x.lower() != SMTP_USER})[:5]
                    st = re.search(r'Status:\s*([245]\.\d+\.\d+)', t)
                    rec['status'] = st.group(1) if st else ''
                out['messages'].append(rec)
    finally:
        try:
            M.logout()
        except Exception:
            pass
    return out
