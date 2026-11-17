/**
 * Автоматизация учёта в Google Таблице (внутренняя копия «Учёт сувенирки»).
 * Установка: Таблица → Расширения → Apps Script → вставить этот файл → выполнить setup() один раз (разрешить доступ)
 * → Развернуть → Новое развертывание → Веб-приложение (выполнять от моего имени, доступ: все) → URL вставить в config.js → appsScriptUrl.
 *
 *  • doPost — сайт присылает заявку: строка в «Заказы» (статус «бронь») + строки в «Бронь»; клиенту уходит письмо со счётом (SEND_INVOICE_EMAIL).
 *  • doGet?action=reservations — активные брони для сайта (к продаже = остаток − бронь).
 *  • onOrderEdit — менеджер ставит в «Заказы» статус «оплачен» → списывается «Количество» на вкладке «Склад …» (один раз).
 *    «снята» → бронь освобождается.
 *  • expireReservations — каждый час: просроченные «бронь» → «истекла», товар снова к продаже (склад не меняется).
 *  • Доставка и согласия (152-ФЗ): в «Заказы» дописываются колонки EXTRA_COLS справа от существующих (старые не сдвигаются).
 *    Заголовки создаются сами (setup() или первый заказ). «Трек-номер» заполняет сотрудник после отправки.
 */
const CONF = {
  ORDERS: 'Заказы', RES: 'Бронь',
  STOCK_TABS: { // первая непустая вкладка из списка
    keychains: ['Склад брелки (копия)', 'Склад брелки'], pins: ['Склад значки (копия)', 'Склад значки'],
    magnets: ['Склад магниты (копия)', 'Склад магниты'], earrings: ['Склад серьги  (копия)', 'Склад серьги ', 'Склад серьги']
  },
  SEND_INVOICE_EMAIL: true,          // отправлять клиенту счёт письмом
  SELLER_EMAIL: 'iptns@mail.ru',     // сюда всегда уходит отдельное письмо «Новый заказ» (+ Reply-To писем клиенту)
  SHOP_NAME: 'Сувенирка',            // имя отправителя
  PHONE: '8 (964) 342-69-67',        // как в config.js
  TELEGRAM: 'https://t.me/+79643426967',
  WHATSAPP: 'https://wa.me/79643426967',
  BASE_COLS: 16,                     // первые 16 колонок «Заказы» — как раньше (заявка … комментарий)
  // Новые колонки «Заказы» — добавляются в конец, если их ещё нет
  EXTRA_COLS: ['Служба доставки', 'Город доставки', 'Адрес / ПВЗ', 'Индекс', 'Получатель', 'Телефон получателя',
    'Комментарий к доставке', 'Оплата доставки', 'Трек-номер', 'Согласие на обработку ПД', 'Согласие с условиями',
    'Согласие на рассылку', 'Дата и время согласий', 'Версия документов', 'Товары']
};
const ss = () => SpreadsheetApp.getActive();
const sh = n => ss().getSheetByName(n);
const TZ = () => { let z = ''; try { z = ss().getSpreadsheetTimeZone(); } catch (e) {} if (!z) { try { z = Session.getScriptTimeZone(); } catch (e) {} } return z || 'Europe/Moscow'; };
const fmt = d => Utilities.formatDate(new Date(d), TZ(), 'dd.MM.yyyy HH:mm');
function headIdx(s){ const h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0]; const m = {}; h.forEach((k, i) => m[String(k).trim()] = i); return m; }
function stockSheet(cat){ for (const n of CONF.STOCK_TABS[cat] || []) { const s = sh(n); if (s && s.getLastRow() > 1) return s; } return null; }

function ensureOrderColumns(){
  const ord = sh(CONF.ORDERS), last = Math.max(ord.getLastColumn(), CONF.BASE_COLS);
  const head = ord.getRange(1, 1, 1, last).getValues()[0].map(x => String(x).trim());
  const missing = CONF.EXTRA_COLS.filter(c => head.indexOf(c) === -1);
  if (missing.length) {
    // на листе может не хватать колонок (getRange за пределами листа падает) — добавляем
    const need = last + missing.length - ord.getMaxColumns();
    if (need > 0) ord.insertColumnsAfter(ord.getMaxColumns(), need);
    ord.getRange(1, last + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
  }
  return headIdx(ord);
}
function extraValues(o){
  const d = o.delivery || {}, c = o.consents || {}, yn = v => v ? 'да' : 'нет';
  return {
    'Служба доставки': d.service || '', 'Город доставки': d.city || '', 'Адрес / ПВЗ': d.address || '', 'Индекс': d.postIndex || '',
    'Получатель': d.recipientName || '', 'Телефон получателя': d.recipientPhone || '', 'Комментарий к доставке': d.comment || '',
    'Оплата доставки': d.payer || '', 'Трек-номер': '',
    'Согласие на обработку ПД': o.consents ? yn(c.personalData) : '', 'Согласие с условиями': o.consents ? yn(c.terms) : '',
    'Согласие на рассылку': o.consents ? yn(c.marketing) : '', 'Дата и время согласий': c.acceptedAt ? fmt(c.acceptedAt) : '',
    'Версия документов': c.docsVersion || '', 'Товары': itemsCell(o)
  };
}
function deliveryHtml(o){
  const d = o.delivery; if (!d) return '';
  const e = v => String(v == null ? '' : v).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  return '<div style="font:14px Arial,sans-serif;border:2px dashed #e0a100;padding:10px 12px;margin:0 0 16px;max-width:800px">' +
    '<b>Доставка:</b> ' + e(d.service) + '<br>' + e([d.postIndex, d.city, d.address].filter(String).join(', ')) +
    '<br>Получатель: ' + e(d.recipientName) + ', ' + e(d.recipientPhone) + (d.comment ? '<br>Комментарий: ' + e(d.comment) : '') +
    '<br><i>Доставка не входит в счёт — оплачивается получателем при получении по тарифу службы. Отправка из г. Павловск после оплаты заказа; трек-номер пришлём на почту/в мессенджер.</i></div>';
}

function setup(){
  ensureOrderColumns();
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onOrderEdit').forSpreadsheet(ss()).onEdit().create();
  ScriptApp.newTrigger('expireReservations').timeBased().everyHours(1).create();
}

const SCRIPT_VERSION = '2026-11-17.6';
const LOG_TAB = 'Лог', LOG_HEAD = ['Время', 'Событие', 'Заказ', 'Сообщение', 'Подробности'];

// ---------- Надёжная запись: без appendRow/getLastRow ----------
// Последняя строка, где в колонке A есть значение (флажки, проверка данных и форматирование справа не мешают).
function lastDataRow(s){
  const n = s.getMaxRows(); if (n < 1) return 0;
  const v = s.getRange(1, 1, n, 1).getValues();
  for (let i = n - 1; i >= 0; i--) if (String(v[i][0]).trim() !== '') return i + 1;
  return 0;
}
// Строки данных (со 2-й до последней непустой по колонке A)
// display=true — как видно в ячейках (для дат: Таблица может сама превратить «18.11.2026 23:59» в дату в своём поясе)
function dataRows(s, display){
  const last = lastDataRow(s), w = Math.max(s.getLastColumn(), 1);
  if (last <= 1) return [];
  const r = s.getRange(2, 1, last - 1, w);
  return display ? r.getDisplayValues() : r.getValues();
}
// Текст, начинающийся с = + - @ (например, телефон «+7 …»), Таблица считает формулой — сохраняем как текст
const safeCell = v => (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;
// Пишет строки в первую действительно пустую строку (по колонке A), при нехватке места добавляет строки/колонки.
// Возвращает номер первой записанной строки.
function writeRows(s, rows){
  if (!rows || !rows.length) return 0;
  const width = Math.max.apply(null, rows.map(r => r.length));
  const vals = rows.map(r => { const x = r.map(safeCell); while (x.length < width) x.push(''); return x; });
  const start = Math.max(lastDataRow(s), 1) + 1, need = start + vals.length - 1;
  if (need > s.getMaxRows()) s.insertRowsAfter(s.getMaxRows(), need - s.getMaxRows());
  if (width > s.getMaxColumns()) s.insertColumnsAfter(s.getMaxColumns(), width - s.getMaxColumns());
  s.getRange(start, 1, vals.length, width).setValues(vals);
  SpreadsheetApp.flush();
  return start;
}
// Диагностика в свойствах скрипта (без новых разрешений) — читается через ?action=selftest
function remember(key, obj){ try { PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(obj).slice(0, 8000)); } catch (x) {} }
function recall(key){ try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(key) || 'null'); } catch (x) { return null; } }

function logSheet(){
  let s = sh(LOG_TAB);
  if (!s) { s = ss().insertSheet(LOG_TAB); s.getRange(1, 1, 1, LOG_HEAD.length).setValues([LOG_HEAD]).setFontWeight('bold'); s.setFrozenRows(1); }
  else if (String(s.getRange(1, 1).getValue()).trim() === '') s.getRange(1, 1, 1, LOG_HEAD.length).setValues([LOG_HEAD]).setFontWeight('bold');
  return s;
}
// Журнал входящих заявок и ошибок — вкладка «Лог». Возвращает номер строки (0 — не записалось, причина в lastLogError).
function logRow(kind, id, msg, extra){
  try {
    return writeRows(logSheet(), [[fmt(new Date()), kind, id || '', String(msg || '').slice(0, 1000), String(extra || '').slice(0, 2000)]]);
  } catch (err) {
    console.error('logRow', err, err && err.stack);
    remember('lastLogError', {at: new Date().toISOString(), kind: kind, id: id, error: String(err), stack: String(err && err.stack || '')});
    return 0;
  }
}
// Заявка приходит либо JSON-телом (fetch, text/plain), либо полем формы payload (резервная отправка)
function parsePayload(e){
  const p = (e && e.parameter) || {};
  if (p.payload) return JSON.parse(p.payload);
  const raw = e && e.postData && e.postData.contents;
  if (!raw) throw new Error('пустой запрос');
  try { return JSON.parse(raw); }
  catch (err) { const m = String(raw).match(/(?:^|&)payload=([^&]*)/); if (m) return JSON.parse(decodeURIComponent(m[1].replace(/\+/g, ' '))); throw err; }
}
const jsonOut = obj => ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);

// ---------- Письма: клиенту — короткий текст + счёт PDF во вложении; продавцу — всегда отдельное письмо ----------
const escH = v => String(v == null ? '' : v).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
// без toLocaleString: в Apps Script Intl для ru-RU ненадёжен
const rub = n => { const v = Math.round(Number(n || 0) * 100) / 100, [i, f] = Math.abs(v).toFixed(2).split('.');
  return (v < 0 ? '−' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (f === '00' ? '' : ',' + f) + ' ₽'; };
function invoicePdf(data, o, id){
  if (!data.invoiceHtml) return null;
  const inv = o.invoice || {};
  // без кнопки «Печать» и скриптов — это файл, а не страница
  const html = String(data.invoiceHtml)
    .replace(/<div class="tools">[\s\S]*?<\/div>/i, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');
  const name = 'Счёт_' + String(inv.number || id).replace(/[\\/:*?"<>|\s]+/g, '_') + '.pdf';
  return Utilities.newBlob(html, 'text/html', 'invoice.html').getAs('application/pdf').setName(name);
}
function deliveryLine(o){
  const d = o.delivery; if (!d) return '';
  const addr = [d.postIndex, d.city, d.address].filter(x => String(x || '').trim()).join(', ');
  return [d.service, addr].filter(Boolean).join(' — ');
}
const unitShort = u => u === 'комплект' ? 'компл.' : u === 'услуга' ? 'усл.' : 'шт';
// Статус позиции: из наличия (бронь) / под заказ / свой дизайн / услуга
function itemStatus(i){
  if (i.fee) return 'разово, без скидки';
  if (i.custom) return 'свой дизайн, под заказ';
  const a = Number(i.inStockQty) || 0, b = Number(i.madeToOrderQty) || 0;
  if (b && a) return a + ' из наличия (бронь) + ' + b + ' под заказ';
  if (b) return 'под заказ';
  return 'из наличия (бронь)';
}
function itemsList(o){
  return (o.items || []).map(i => (i.name || '') + (i.categoryName ? ' (' + i.categoryName + ')' : '') + ' — ' + (Number(i.qty) || 0) + ' ' + unitShort(i.unit) +
    (i.sum != null ? ', ' + rub(i.sum) : '') + ' — ' + itemStatus(i) + (i.custom && i.link ? '; референс: ' + i.link : ''));
}
// Полный состав заказа одной ячейкой «Товары» (аудит: что заказано, что в брони, что под заказ / свой дизайн)
function itemsCell(o){
  const it = o.items || []; if (!it.length) return '';
  return it.map((i, n) => (n + 1) + '. ' + (i.custom || i.fee ? '' : '[' + (i.id || '') + '] ') + (i.name || '') + (i.categoryName ? ' (' + i.categoryName + ')' : '') +
    ' — ' + (Number(i.qty) || 0) + ' ' + unitShort(i.unit) + ' × ' + rub(i.unitPrice) + ' = ' + rub(i.sum) + ' — ' + itemStatus(i) +
    (i.custom && i.description && String(i.name || '').indexOf(i.description) === -1 ? '; описание: ' + i.description : '') +
    (i.custom && i.link ? '; референс: ' + i.link : '')).join('\n').slice(0, 45000);
}
function customerMail(o, id){
  const inv = o.invoice || {}, ct = o.contact || {}, tt = o.totals || {}, rs = o.reservation || {}, d = o.delivery || null;
  const num = inv.number || id, sum = rub(tt.grand || tt.total), until = rs.expiresAt ? fmt(rs.expiresAt) : '';
  const hello = 'Добрый день' + (ct.name ? ', ' + ct.name : '') + '!';
  const pickup = d && /самовывоз/i.test(String(d.payer || '') + ' ' + String(d.service || ''));
  const dlv = !d ? '' : pickup ? 'Получение: ' + deliveryLine(o) + '.'
    : 'Доставка: ' + deliveryLine(o) + '. Доставка оплачивается получателем при получении по тарифу службы, отправка из г. Павловск после оплаты заказа; трек-номер пришлём.';
  const items = itemsList(o);
  const subject = 'Ваш заказ № ' + id + ' — счёт № ' + num;
  const text = [hello, '',
    'Вы оформили заказ № ' + id + ' на сумму ' + sum + '. Счёт № ' + num + ' во вложении (PDF).',
    until && (rs.lines || []).length ? 'Товар из наличия забронирован до ' + until + ' — оплатите, пожалуйста, до этого времени.' : (until ? 'Счёт действителен до ' + until + '.' : ''),
    dlv, '', items.length ? 'Состав заказа:\n' + items.map(x => '• ' + x).join('\n') : '', '',
    'После оплаты, пожалуйста, пришлите чек (квитанцию / платёжку) любым удобным способом: ответом на это письмо, в Telegram (' + CONF.TELEGRAM + ') или в WhatsApp (' + CONF.WHATSAPP + ').',
    '', 'Спасибо за заказ!', CONF.SHOP_NAME + ', тел. ' + CONF.PHONE].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
  const a = (href, t) => '<a href="' + escH(href) + '">' + escH(t) + '</a>';
  const html = '<div style="font:15px/1.5 Arial,Helvetica,sans-serif;color:#111;max-width:640px">' +
    '<p>' + escH(hello) + '</p>' +
    '<p>Вы оформили заказ <b>№ ' + escH(id) + '</b> на сумму <b>' + escH(sum) + '</b>. Счёт № ' + escH(num) + ' — во вложении (PDF).</p>' +
    (until && (rs.lines || []).length ? '<p>Товар из наличия забронирован до <b>' + escH(until) + '</b> — оплатите, пожалуйста, до этого времени.</p>' : (until ? '<p>Счёт действителен до <b>' + escH(until) + '</b>.</p>' : '')) +
    (dlv ? '<p>' + escH(dlv) + '</p>' : '') +
    (items.length ? '<p style="margin-bottom:4px"><b>Состав заказа:</b></p><ul style="margin-top:0;padding-left:20px">' + items.map(x => '<li>' + escH(x) + '</li>').join('') + '</ul>' : '') +
    '<p>После оплаты, пожалуйста, пришлите чек (квитанцию / платёжку) любым удобным способом: ответом на это письмо, в ' +
    a(CONF.TELEGRAM, 'Telegram') + ' или в ' + a(CONF.WHATSAPP, 'WhatsApp') + '.</p>' +
    '<p>Спасибо за заказ!<br>' + escH(CONF.SHOP_NAME) + ', тел. ' + escH(CONF.PHONE) + '</p></div>';
  return {subject: subject, body: text, htmlBody: html};
}
function sellerMail(o, id){
  const inv = o.invoice || {}, ct = o.contact || {}, tt = o.totals || {}, rs = o.reservation || {}, pay = o.payment || {}, d = o.delivery || {};
  const sum = rub(tt.grand || tt.total);
  const rows = [['Заказ', id], ['Счёт', inv.number || ''], ['Сумма к оплате', sum], ['Способ оплаты', pay.label || ''], ['Режим', o.modeName || ''],
    ['Покупатель', [ct.company, ct.name].filter(Boolean).join(', ')], ['Телефон', ct.phone || ''], ['Почта', ct.email || ''],
    ['Доставка', deliveryLine(o)], ['Получатель', [d.recipientName, d.recipientPhone].filter(Boolean).join(', ')], ['Оплата доставки', d.payer || ''],
    ['Комментарий', [o.customerComment, d.comment].filter(Boolean).join(' | ')], ['Бронь до', rs.expiresAt ? fmt(rs.expiresAt) : '']]
    .filter(r => String(r[1] || '').trim());
  const items = itemsList(o);
  const subject = 'Новый заказ ' + id + ' — ' + sum;
  const text = rows.map(r => r[0] + ': ' + r[1]).join('\n') + (items.length ? '\n\nСостав:\n' + items.map(x => '• ' + x).join('\n') : '') +
    '\n\nСчёт — во вложении. После оплаты поставьте в «Заказы» статус «оплачен».';
  const html = '<div style="font:14px/1.45 Arial,Helvetica,sans-serif;color:#111;max-width:680px"><table style="border-collapse:collapse">' +
    rows.map(r => '<tr><td style="padding:3px 12px 3px 0;color:#555;vertical-align:top">' + escH(r[0]) + '</td><td style="padding:3px 0"><b>' + escH(r[1]) + '</b></td></tr>').join('') + '</table>' +
    (items.length ? '<p style="margin-bottom:4px"><b>Состав:</b></p><ul style="margin-top:0;padding-left:20px">' + items.map(x => '<li>' + escH(x) + '</li>').join('') + '</ul>' : '') +
    '<p>Счёт — во вложении. После оплаты поставьте в «Заказы» статус «оплачен».</p></div>';
  return {subject: subject, body: text, htmlBody: html};
}
function sendOrderEmails(data, o, id, trace){
  const ct = o.contact || {}, res = {at: new Date().toISOString(), id: id, customer: '', seller: '', pdf: '', quotaBefore: null, quotaAfter: null};
  const quota = () => { try { return MailApp.getRemainingDailyQuota(); } catch (x) { return 'нет данных: ' + x; } };
  res.quotaBefore = quota();
  let pdf = null;
  try { pdf = invoicePdf(data, o, id); res.pdf = pdf ? pdf.getName() + ' (' + pdf.getBytes().length + ' байт)' : 'нет invoiceHtml'; }
  catch (err) { res.pdf = 'ошибка: ' + err; logRow('ошибка PDF', id, err, err && err.stack); }
  const att = pdf ? [pdf] : [];
  // 1) клиенту
  if (!CONF.SEND_INVOICE_EMAIL) res.customer = 'выключено';
  else if (!ct.email) res.customer = 'нет email';
  else try {
    const m = customerMail(o, id);
    MailApp.sendEmail({to: ct.email, replyTo: CONF.SELLER_EMAIL, name: CONF.SHOP_NAME, subject: m.subject, body: m.body, htmlBody: m.htmlBody, attachments: att});
    res.customer = 'отправлено: ' + ct.email + (pdf ? '' : ' (без PDF)');
  } catch (err) { res.customer = 'ошибка: ' + err; logRow('ошибка письма клиенту', id, err, (err && err.stack || '') + ' | квота: ' + res.quotaBefore); }
  // 2) продавцу — всегда отдельным письмом (раньше был cc в том же письме: при совпадении адресов приходило одно письмо)
  if (CONF.SELLER_EMAIL) try {
    const m = sellerMail(o, id);
    MailApp.sendEmail({to: CONF.SELLER_EMAIL, replyTo: ct.email || CONF.SELLER_EMAIL, name: CONF.SHOP_NAME + ' — заказы', subject: m.subject, body: m.body, htmlBody: m.htmlBody, attachments: att});
    res.seller = 'отправлено: ' + CONF.SELLER_EMAIL;
  } catch (err) { res.seller = 'ошибка: ' + err; logRow('ошибка письма продавцу', id, err, (err && err.stack || '') + ' | квота: ' + res.quotaBefore); }
  else res.seller = 'SELLER_EMAIL не задан';
  res.quotaAfter = quota();
  trace.mail = {customer: res.customer, seller: res.seller, pdf: res.pdf, quotaBefore: res.quotaBefore, quotaAfter: res.quotaAfter};
  remember('lastMail', res);
  logRow('письма', id, 'клиенту: ' + res.customer + '; продавцу: ' + res.seller, 'PDF: ' + res.pdf + ' | квота MailApp: ' + res.quotaBefore + ' → ' + res.quotaAfter);
  return res;
}

function doPost(e){
  let id = '', lock = null;
  const trace = {at: new Date().toISOString(), version: SCRIPT_VERSION, stage: 'старт', spreadsheetId: '', orderRow: 0, resRow: 0, logRow: 0, mail: ''};
  try {
    trace.spreadsheetId = ss().getId();
    trace.stage = 'разбор заявки';
    const data = parsePayload(e), o = data.order || {};
    id = o.id || ''; trace.id = id;
    if (!id) throw new Error('нет order.id');
    const pay = o.payment || {}, inv = o.invoice || {}, ct = o.contact || {}, tt = o.totals || {}, rs = o.reservation || {}, lines = rs.lines || [];
    const created = o.createdAt || new Date().toISOString(), until = rs.expiresAt || created;
    trace.stage = 'блокировка';
    lock = LockService.getScriptLock(); lock.waitLock(20000);
    const ord = sh(CONF.ORDERS); if (!ord) throw new Error('нет вкладки «' + CONF.ORDERS + '»');
    const res = sh(CONF.RES); if (!res) throw new Error('нет вкладки «' + CONF.RES + '»');
    trace.stage = 'проверка повтора';
    const ids = dataRows(ord).map(r => String(r[0]));
    if (ids.indexOf(String(id)) !== -1) {
      lock.releaseLock(); lock = null;
      // повтор (резервная отправка формой) не затирает lastPost — там остаётся результат настоящей записи и писем
      trace.stage = 'повтор'; trace.logRow = logRow('повтор', id, 'заказ уже записан — пропущен'); remember('lastDuplicate', trace);
      return jsonOut({ok: true, duplicate: true, version: SCRIPT_VERSION});
    }
    let h = {};
    try { h = ensureOrderColumns(); } catch (err) { logRow('ошибка колонок', id, err); }
    const width = Math.max(ord.getLastColumn(), CONF.BASE_COLS);
    const row = [id, fmt(created), o.modeName || '', pay.label || '', inv.number || '', ct.name || '', ct.phone || '', ct.email || '', ct.company || '',
      tt.total || 0, tt.markup || 0, tt.grand || tt.total || 0, fmt(until), 'бронь', '',
      o.customerComment != null ? o.customerComment : (o.comment || '')];
    while (row.length < width) row.push('');
    try { const ex = extraValues(o); Object.keys(ex).forEach(k => { if (h[k] != null && h[k] >= CONF.BASE_COLS) row[h[k]] = ex[k]; }); }
    catch (err) { logRow('ошибка доставки/согласий', id, err); }
    trace.stage = 'запись в «Заказы»';
    trace.orderRow = writeRows(ord, [row]);
    trace.stage = 'запись в «Бронь»';
    trace.resRow = writeRows(res, lines.map(l => [id, fmt(created), fmt(until), l.productId || '', l.productName || '', l.category || '', Number(l.qty) || 0,
      'бронь', pay.label || '', ct.company || ct.name || '', (l.stockRows || []).join(' | '), '']));
    lock.releaseLock(); lock = null;
    trace.stage = 'лог';
    trace.logRow = logRow('заказ', id, 'записан: строка ' + trace.orderRow + ' в «Заказы», ' + lines.length + ' строк брони с ' + (trace.resRow || '—'), (o.delivery && o.delivery.service) || '');
    trace.stage = 'письма';
    sendOrderEmails(data, o, id, trace);
    trace.stage = 'готово'; remember('lastPost', trace);
    return jsonOut({ok: true, version: SCRIPT_VERSION, orderRow: trace.orderRow, resRow: trace.resRow, logRow: trace.logRow});
  } catch (err) {
    console.error('doPost', trace.stage, err, err && err.stack);
    trace.error = String(err); trace.stack = String(err && err.stack || '');
    trace.logRow = logRow('ОШИБКА', id, err, (err && err.stack || '') + ' | этап: ' + trace.stage + ' | ' + String(e && e.postData && e.postData.contents || '').slice(0, 500));
    remember('lastPost', trace);
    return jsonOut({ok: false, error: String(err), stage: trace.stage, logRow: trace.logRow, version: SCRIPT_VERSION});
  } finally { if (lock) try { lock.releaseLock(); } catch (x) {} }
}

function tabInfo(n){
  const s = sh(n); if (!s) return {tab: n, exists: false};
  const info = {tab: n, exists: true, sheetId: s.getSheetId(), maxRows: s.getMaxRows(), maxColumns: s.getMaxColumns(), getLastRow: s.getLastRow(), lastDataRowA: lastDataRow(s)};
  try { info.protections = s.getProtections(SpreadsheetApp.ProtectionType.SHEET).length + s.getProtections(SpreadsheetApp.ProtectionType.RANGE).length; } catch (x) { info.protections = String(x); }
  try { info.filter = !!s.getFilter(); } catch (x) {}
  return info;
}
// GET ?action=selftest — пишет одну строку в «Лог» и сообщает, куда записал, плюс состояние вкладок и последние ошибки
function selftest(){
  const out = {ok: false, version: SCRIPT_VERSION};
  try { const b = ss(); out.spreadsheetId = b.getId(); out.spreadsheetName = b.getName(); out.url = b.getUrl(); out.timeZone = b.getSpreadsheetTimeZone(); }
  catch (err) { out.error = 'нет доступа к таблице: ' + err; return out; }
  try {
    const s = logSheet(); out.logSheetId = s.getSheetId();
    out.row = writeRows(s, [[fmt(new Date()), 'selftest', '', 'проверка записи', 'GET ?action=selftest']]);
    out.readBack = s.getRange(out.row, 1, 1, 5).getDisplayValues()[0];
    out.ok = out.readBack[1] === 'selftest';
  } catch (err) { out.error = String(err); out.stack = String(err && err.stack || ''); }
  out.tabs = [CONF.ORDERS, CONF.RES, LOG_TAB].map(tabInfo);
  try { out.triggers = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction() + ' / ' + t.getEventType()); } catch (x) { out.triggers = String(x); }
  out.lastPost = recall('lastPost'); out.lastMail = recall('lastMail'); out.lastLogError = recall('lastLogError');
  return out;
}

function doGet(e){
  const action = e && e.parameter && e.parameter.action;
  if (action === 'version') return jsonOut({ok: true, version: SCRIPT_VERSION, sheet: ss().getName(), spreadsheetId: ss().getId(), tabs: [CONF.ORDERS, CONF.RES].map(n => n + (sh(n) ? ': есть' : ': НЕТ'))});
  if (action === 'selftest') return jsonOut(selftest());
  if (action === 'last') return jsonOut({version: SCRIPT_VERSION, spreadsheetId: ss().getId(), lastPost: recall('lastPost'), lastDuplicate: recall('lastDuplicate'), lastMail: recall('lastMail'), lastLogError: recall('lastLogError'), tabs: [CONF.ORDERS, CONF.RES, LOG_TAB].map(tabInfo)});
  const res = sh(CONF.RES), h = headIdx(res), now = new Date();
  // даты — по тексту ячейки (см. dataRows display), числа — по значению
  const vals = dataRows(res), disp = dataRows(res, true);
  const out = vals.map((r, i) => ({r: r, until: parseDate(disp[i][h.expiresAt])}))
    .filter(x => String(x.r[h.status]).trim().toLowerCase() === 'бронь' && x.until > now)
    .map(x => ({orderId: x.r[h.orderId], productId: x.r[h.productId], productName: x.r[h.productName], qty: Number(x.r[h.qty]), status: 'бронь', expiresAt: x.until.toISOString()}));
  return ContentService.createTextOutput(JSON.stringify({reservations: out})).setMimeType(ContentService.MimeType.JSON);
}
// Смещение пояса TZ() в минутах для момента d (учитывает летнее время, если оно есть)
function tzOffsetMin(d){ const z = Utilities.formatDate(d, TZ(), 'Z'), sg = z[0] === '-' ? -1 : 1; return sg * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5))); }
// «дд.мм.гггг чч:мм» — время на часах пояса TZ() (тот же пояс, в котором пишет fmt) → точный момент
function wallTime(y, mo, d, h, mi){
  const guess = Date.UTC(y, mo, d, h, mi);
  let t = guess - tzOffsetMin(new Date(guess)) * 60000;
  t = guess - tzOffsetMin(new Date(t)) * 60000;
  return new Date(t);
}
function parseDate(v){
  if (v instanceof Date) return v;
  const m = String(v).match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  return m ? wallTime(+m[3], +m[2] - 1, +m[1], m[4] != null ? +m[4] : 23, m[5] != null ? +m[5] : 59) : new Date(v);
}

function onOrderEdit(e){
  const s = e.range.getSheet(); if (s.getName() !== CONF.ORDERS || e.range.getRow() < 2) return;
  const h = headIdx(s); if (e.range.getColumn() !== h['Статус'] + 1) return;
  processOrderRow(e.range.getRow());
}
function processAll(){ const s = sh(CONF.ORDERS), last = lastDataRow(s); for (let r = 2; r <= last; r++) processOrderRow(r); expireReservations(); }

function processOrderRow(row){
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const ord = sh(CONF.ORDERS), h = headIdx(ord), v = ord.getRange(row, 1, 1, ord.getLastColumn()).getValues()[0];
    const st = String(v[h['Статус']]).trim().toLowerCase(), id = v[h.orderId];
    const res = sh(CONF.RES), rh = headIdx(res);
    const rrows = dataRows(res);
    if (st === 'оплачен' && !String(v[h['Списано со склада']]).trim()) {
      rrows.forEach((r, i) => {
        if (r[rh.orderId] !== id || String(r[rh['Списано']]).trim()) return;
        deduct(r[rh.category], String(r[rh['Строка склада']] || '').trim() ? String(r[rh['Строка склада']]).split(' | ') : [r[rh.productName]], Number(r[rh.qty]));
        res.getRange(i + 2, rh.status + 1).setValue('оплачен'); res.getRange(i + 2, rh['Списано'] + 1).setValue(fmt(new Date()));
      });
      ord.getRange(row, h['Списано со склада'] + 1).setValue('да, ' + fmt(new Date()));
    } else if (st === 'снята') {
      rrows.forEach((r, i) => { if (r[rh.orderId] === id && String(r[rh.status]).toLowerCase() === 'бронь') res.getRange(i + 2, rh.status + 1).setValue('снята'); });
    }
  } finally { lock.releaseLock(); }
}
function deduct(cat, names, qty){
  const s = stockSheet(cat); if (!s) return;
  const h = headIdx(s), data = s.getRange(2, 1, s.getLastRow() - 1, s.getLastColumn()).getValues();
  const col = h['Количество'], keys = names.map(n => String(n).trim().toLowerCase()), name = names.join(' / ');
  for (let i = 0; i < data.length && qty > 0; i++) {
    if (keys.indexOf(String(data[i][h['Название товара']]).trim().toLowerCase()) === -1) continue;
    const q = Number(data[i][col]) || 0, take = Math.min(q, qty);
    if (take) { s.getRange(i + 2, col + 1).setValue(q - take); qty -= take; }
  }
  if (qty > 0) s.getParent().toast(`${name}: не хватило ${qty} шт на «${s.getName()}»`, 'Списание', 10);
}
function expireReservations(){
  const now = new Date(), res = sh(CONF.RES), rh = headIdx(res), ord = sh(CONF.ORDERS), oh = headIdx(ord);
  dataRows(res, true).forEach((r, i) => {
    if (String(r[rh.status]).trim().toLowerCase() === 'бронь' && parseDate(r[rh.expiresAt]) <= now) res.getRange(i + 2, rh.status + 1).setValue('истекла');
  });
  dataRows(ord, true).forEach((r, i) => {
    if (String(r[oh['Статус']]).trim().toLowerCase() === 'бронь' && parseDate(r[oh['Бронь до']]) <= now) ord.getRange(i + 2, oh['Статус'] + 1).setValue('истекла');
  });
}
function onOpen(){ SpreadsheetApp.getUi().createMenu('Мерч').addItem('Обработать заказы (оплачен / истекла)', 'processAll').addToUi(); }
