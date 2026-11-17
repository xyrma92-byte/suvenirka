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
  SELLER_EMAIL: 'iptns@mail.ru',     // копия каждого счёта
  BASE_COLS: 16,                     // первые 16 колонок «Заказы» — как раньше (заявка … комментарий)
  // Новые колонки «Заказы» — добавляются в конец, если их ещё нет
  EXTRA_COLS: ['Служба доставки', 'Город доставки', 'Адрес / ПВЗ', 'Индекс', 'Получатель', 'Телефон получателя',
    'Комментарий к доставке', 'Оплата доставки', 'Трек-номер', 'Согласие на обработку ПД', 'Согласие с условиями',
    'Согласие на рассылку', 'Дата и время согласий', 'Версия документов']
};
const ss = () => SpreadsheetApp.getActive();
const sh = n => ss().getSheetByName(n);
const fmt = d => Utilities.formatDate(new Date(d), ss().getSpreadsheetTimeZone(), 'dd.MM.yyyy HH:mm');
function headIdx(s){ const h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0]; const m = {}; h.forEach((k, i) => m[String(k).trim()] = i); return m; }
function stockSheet(cat){ for (const n of CONF.STOCK_TABS[cat] || []) { const s = sh(n); if (s && s.getLastRow() > 1) return s; } return null; }

function ensureOrderColumns(){
  const ord = sh(CONF.ORDERS), last = Math.max(ord.getLastColumn(), CONF.BASE_COLS);
  const head = ord.getRange(1, 1, 1, last).getValues()[0].map(x => String(x).trim());
  const missing = CONF.EXTRA_COLS.filter(c => head.indexOf(c) === -1);
  if (missing.length) ord.getRange(1, last + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
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
    'Версия документов': c.docsVersion || ''
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

const SCRIPT_VERSION = '2026-11-17.2';
// Журнал входящих заявок и ошибок — вкладка «Лог» (создаётся сама)
function logRow(kind, id, msg, extra){
  try {
    let s = sh('Лог');
    if (!s) { s = ss().insertSheet('Лог'); s.appendRow(['Время', 'Событие', 'Заказ', 'Сообщение', 'Подробности']); s.setFrozenRows(1); }
    s.appendRow([fmt(new Date()), kind, id || '', String(msg || '').slice(0, 1000), String(extra || '').slice(0, 2000)]);
  } catch (err) { console.error('logRow', err); }
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

function doPost(e){
  let id = '', lock = null;
  try {
    const data = parsePayload(e), o = data.order || {};
    id = o.id || '';
    if (!id) throw new Error('нет order.id');
    const pay = o.payment || {}, inv = o.invoice || {}, ct = o.contact || {}, tt = o.totals || {}, rs = o.reservation || {}, lines = rs.lines || [];
    const created = o.createdAt || new Date().toISOString(), until = rs.expiresAt || created;
    lock = LockService.getScriptLock(); lock.waitLock(20000);
    const ord = sh(CONF.ORDERS); if (!ord) throw new Error('нет вкладки «' + CONF.ORDERS + '»');
    const res = sh(CONF.RES); if (!res) throw new Error('нет вкладки «' + CONF.RES + '»');
    const ids = ord.getLastRow() > 1 ? ord.getRange(2, 1, ord.getLastRow() - 1, 1).getValues().flat().map(String) : [];
    if (ids.indexOf(String(id)) !== -1) { logRow('повтор', id, 'заказ уже записан — пропущен'); return jsonOut({ok: true, duplicate: true, version: SCRIPT_VERSION}); }
    let h = {};
    try { h = ensureOrderColumns(); } catch (err) { logRow('ошибка колонок', id, err); }
    const width = Math.max(ord.getLastColumn(), CONF.BASE_COLS);
    const row = [id, fmt(created), o.modeName || '', pay.label || '', inv.number || '', ct.name || '', ct.phone || '', ct.email || '', ct.company || '',
      tt.total || 0, tt.markup || 0, tt.grand || tt.total || 0, fmt(until), 'бронь', '',
      o.customerComment != null ? o.customerComment : (o.comment || '')];
    while (row.length < width) row.push('');
    try { const ex = extraValues(o); Object.keys(ex).forEach(k => { if (h[k] != null && h[k] >= CONF.BASE_COLS) row[h[k]] = ex[k]; }); }
    catch (err) { logRow('ошибка доставки/согласий', id, err); }
    ord.appendRow(row);
    lines.forEach(l => res.appendRow([id, fmt(created), fmt(until), l.productId || '', l.productName || '', l.category || '', Number(l.qty) || 0,
      'бронь', pay.label || '', ct.company || ct.name || '', (l.stockRows || []).join(' | '), '']));
    lock.releaseLock(); lock = null;
    logRow('заказ', id, 'записан: ' + lines.length + ' строк брони', (o.delivery && o.delivery.service) || '');
    if (CONF.SEND_INVOICE_EMAIL && data.invoiceHtml && ct.email) {
      try {
        const body = String(data.invoiceHtml).replace(/<body[^>]*>/i, m => m + deliveryHtml(o));
        MailApp.sendEmail({to: ct.email, cc: CONF.SELLER_EMAIL, subject: `Счёт № ${inv.number || id} — ${pay.label || ''}`, htmlBody: body});
      } catch (err) { logRow('ошибка письма', id, err, err && err.stack); }
    }
    return jsonOut({ok: true, version: SCRIPT_VERSION});
  } catch (err) {
    logRow('ОШИБКА', id, err, (err && err.stack || '') + ' | ' + String(e && e.postData && e.postData.contents || '').slice(0, 500));
    return jsonOut({ok: false, error: String(err), version: SCRIPT_VERSION});
  } finally { if (lock) try { lock.releaseLock(); } catch (x) {} }
}

function doGet(e){
  const action = e && e.parameter && e.parameter.action;
  if (action === 'version') return jsonOut({ok: true, version: SCRIPT_VERSION, sheet: ss().getName(), tabs: [CONF.ORDERS, CONF.RES].map(n => n + (sh(n) ? ': есть' : ': НЕТ'))});
  const res = sh(CONF.RES), h = headIdx(res), now = new Date();
  const rows = res.getLastRow() > 1 ? res.getRange(2, 1, res.getLastRow() - 1, res.getLastColumn()).getValues() : [];
  const out = rows.filter(r => String(r[h.status]).trim().toLowerCase() === 'бронь' && parseDate(r[h.expiresAt]) > now)
    .map(r => ({orderId: r[h.orderId], productId: r[h.productId], productName: r[h.productName], qty: Number(r[h.qty]), status: 'бронь', expiresAt: parseDate(r[h.expiresAt]).toISOString()}));
  return ContentService.createTextOutput(JSON.stringify({reservations: out})).setMimeType(ContentService.MimeType.JSON);
}
function parseDate(v){
  if (v instanceof Date) return v;
  const m = String(v).match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 23), +(m[5] || 59)) : new Date(v);
}

function onOrderEdit(e){
  const s = e.range.getSheet(); if (s.getName() !== CONF.ORDERS || e.range.getRow() < 2) return;
  const h = headIdx(s); if (e.range.getColumn() !== h['Статус'] + 1) return;
  processOrderRow(e.range.getRow());
}
function processAll(){ const s = sh(CONF.ORDERS); for (let r = 2; r <= s.getLastRow(); r++) processOrderRow(r); expireReservations(); }

function processOrderRow(row){
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const ord = sh(CONF.ORDERS), h = headIdx(ord), v = ord.getRange(row, 1, 1, ord.getLastColumn()).getValues()[0];
    const st = String(v[h['Статус']]).trim().toLowerCase(), id = v[h.orderId];
    const res = sh(CONF.RES), rh = headIdx(res);
    const rrows = res.getLastRow() > 1 ? res.getRange(2, 1, res.getLastRow() - 1, res.getLastColumn()).getValues() : [];
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
  if (res.getLastRow() > 1) res.getRange(2, 1, res.getLastRow() - 1, res.getLastColumn()).getValues().forEach((r, i) => {
    if (String(r[rh.status]).trim().toLowerCase() === 'бронь' && parseDate(r[rh.expiresAt]) <= now) res.getRange(i + 2, rh.status + 1).setValue('истекла');
  });
  if (ord.getLastRow() > 1) ord.getRange(2, 1, ord.getLastRow() - 1, ord.getLastColumn()).getValues().forEach((r, i) => {
    if (String(r[oh['Статус']]).trim().toLowerCase() === 'бронь' && parseDate(r[oh['Бронь до']]) <= now) ord.getRange(i + 2, oh['Статус'] + 1).setValue('истекла');
  });
}
function onOpen(){ SpreadsheetApp.getUi().createMenu('Мерч').addItem('Обработать заказы (оплачен / истекла)', 'processAll').addToUi(); }
