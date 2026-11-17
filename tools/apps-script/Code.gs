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

const SCRIPT_VERSION = '2026-11-17.3';
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
function dataRows(s){
  const last = lastDataRow(s), w = Math.max(s.getLastColumn(), 1);
  return last > 1 ? s.getRange(2, 1, last - 1, w).getValues() : [];
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
      trace.stage = 'повтор'; trace.logRow = logRow('повтор', id, 'заказ уже записан — пропущен'); remember('lastPost', trace);
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
    if (CONF.SEND_INVOICE_EMAIL && data.invoiceHtml && ct.email) {
      trace.stage = 'письмо';
      try {
        const body = String(data.invoiceHtml).replace(/<body[^>]*>/i, m => m + deliveryHtml(o));
        MailApp.sendEmail({to: ct.email, cc: CONF.SELLER_EMAIL, subject: `Счёт № ${inv.number || id} — ${pay.label || ''}`, htmlBody: body});
        trace.mail = 'отправлено';
      } catch (err) { trace.mail = 'ошибка: ' + err; logRow('ошибка письма', id, err, err && err.stack); }
    } else trace.mail = 'не отправлялось (' + (!data.invoiceHtml ? 'нет invoiceHtml' : !ct.email ? 'нет email' : 'выключено') + ')';
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
  out.lastPost = recall('lastPost'); out.lastLogError = recall('lastLogError');
  return out;
}

function doGet(e){
  const action = e && e.parameter && e.parameter.action;
  if (action === 'version') return jsonOut({ok: true, version: SCRIPT_VERSION, sheet: ss().getName(), spreadsheetId: ss().getId(), tabs: [CONF.ORDERS, CONF.RES].map(n => n + (sh(n) ? ': есть' : ': НЕТ'))});
  if (action === 'selftest') return jsonOut(selftest());
  if (action === 'last') return jsonOut({version: SCRIPT_VERSION, spreadsheetId: ss().getId(), lastPost: recall('lastPost'), lastLogError: recall('lastLogError'), tabs: [CONF.ORDERS, CONF.RES, LOG_TAB].map(tabInfo)});
  const res = sh(CONF.RES), h = headIdx(res), now = new Date();
  const out = dataRows(res).filter(r => String(r[h.status]).trim().toLowerCase() === 'бронь' && parseDate(r[h.expiresAt]) > now)
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
  dataRows(res).forEach((r, i) => {
    if (String(r[rh.status]).trim().toLowerCase() === 'бронь' && parseDate(r[rh.expiresAt]) <= now) res.getRange(i + 2, rh.status + 1).setValue('истекла');
  });
  dataRows(ord).forEach((r, i) => {
    if (String(r[oh['Статус']]).trim().toLowerCase() === 'бронь' && parseDate(r[oh['Бронь до']]) <= now) ord.getRange(i + 2, oh['Статус'] + 1).setValue('истекла');
  });
}
function onOpen(){ SpreadsheetApp.getUi().createMenu('Мерч').addItem('Обработать заказы (оплачен / истекла)', 'processAll').addToUi(); }
