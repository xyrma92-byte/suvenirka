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


def key_for(email):
    return 'outreach/sent/' + hashlib.sha256(email.strip().lower().encode()).hexdigest()[:24] + '.json'


def build(email, name):
    body = open(os.path.join(HERE, 'body.txt'), encoding='utf-8').read().replace('{Название}', name)
    e = lambda s: html.escape(s, quote=True)
    # текст: ссылки после фраз; HTML: ссылки спрятаны в слова
    text = (body.replace('можно на нашем сайте.', f'можно на нашем сайте: {SITE}')
                .replace('в нашем магазине на Ozon.', f'в нашем магазине на Ozon: {OZON}'))
    paras = []
    for block in body.strip().split('\n\n'):
        h = '<br>'.join(e(x) for x in block.split('\n'))
        h = h.replace('на нашем сайте', f'<a href="{SITE}">на нашем сайте</a>')
        h = h.replace('в нашем магазине на Ozon', f'<a href="{OZON}">в нашем магазине на Ozon</a>')
        h = h.replace('в Telegram или WhatsApp:', f'в <a href="{TG}">Telegram</a> или <a href="{WA}">WhatsApp</a>:')
        h = h.replace(e(SMTP_USER), f'<a href="mailto:{SMTP_USER}">{SMTP_USER}</a>')
        h = h.replace('настоящего металла', '<b>настоящего металла</b>', 1)
        paras.append(f'<p>{h}</p>')
    hb = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:640px">' + ''.join(paras) + '</div>'
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
                rec.update(status='отправлено' if code == 250 else 'ошибка', smtp_code=code, smtp_resp=resp.decode(errors='replace')[:200],
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
