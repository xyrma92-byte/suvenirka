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
 */
const CONF = {
  ORDERS: 'Заказы', RES: 'Бронь',
  STOCK_TABS: { // первая непустая вкладка из списка
    keychains: ['Склад брелки (копия)', 'Склад брелки'], pins: ['Склад значки (копия)', 'Склад значки'],
    magnets: ['Склад магниты (копия)', 'Склад магниты'], earrings: ['Склад серьги  (копия)', 'Склад серьги ', 'Склад серьги']
  },
  SEND_INVOICE_EMAIL: true,          // отправлять клиенту счёт письмом
  SELLER_EMAIL: 'iptns@mail.ru'      // копия каждого счёта
};
const ss = () => SpreadsheetApp.getActive();
const sh = n => ss().getSheetByName(n);
const fmt = d => Utilities.formatDate(new Date(d), ss().getSpreadsheetTimeZone(), 'dd.MM.yyyy HH:mm');
function headIdx(s){ const h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0]; const m = {}; h.forEach((k, i) => m[String(k).trim()] = i); return m; }
function stockSheet(cat){ for (const n of CONF.STOCK_TABS[cat] || []) { const s = sh(n); if (s && s.getLastRow() > 1) return s; } return null; }

function setup(){
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onOrderEdit').forSpreadsheet(ss()).onEdit().create();
  ScriptApp.newTrigger('expireReservations').timeBased().everyHours(1).create();
}

function doPost(e){
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const data = JSON.parse(e.postData.contents), o = data.order;
    const ord = sh(CONF.ORDERS), ids = ord.getRange(2, 1, Math.max(1, ord.getLastRow() - 1), 1).getValues().flat();
    if (ids.indexOf(o.id) === -1) {
      ord.appendRow([o.id, fmt(o.createdAt), o.modeName, o.payment.label, o.invoice.number, o.contact.name, o.contact.phone, o.contact.email, o.contact.company,
        o.totals.total, o.totals.markup || 0, o.totals.grand, fmt(o.reservation.expiresAt), 'бронь', '', o.comment || '']);
      const res = sh(CONF.RES);
      o.reservation.lines.forEach(l => res.appendRow([o.id, fmt(o.createdAt), fmt(o.reservation.expiresAt), l.productId, l.productName, l.category, l.qty,
        'бронь', o.payment.label, o.contact.company || o.contact.name, (l.stockRows || []).join(' | '), '']));
      if (CONF.SEND_INVOICE_EMAIL && data.invoiceHtml && o.contact.email) {
        MailApp.sendEmail({to: o.contact.email, cc: CONF.SELLER_EMAIL, subject: `Счёт № ${o.invoice.number} — ${o.payment.label}`, htmlBody: data.invoiceHtml});
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  } finally { lock.releaseLock(); }
}

function doGet(e){
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
