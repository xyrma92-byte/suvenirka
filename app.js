(function(){
'use strict';
const CFG = window.SITE_CONFIG;
const PRODUCTS = window.PRODUCTS || [];
const BY_ID = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
const CATS = [
  {id:'all', name:'Все'},
  {id:'keychains', name:'Брелоки', one:'Брелок'},
  {id:'pins', name:'Значки', one:'Значок'},
  {id:'magnets', name:'Магниты', one:'Магнит'},
  {id:'earrings', name:'Серьги', one:'Серьги (комплект 2 шт)'}
];
const CAT_NAME = Object.fromEntries(CATS.map(c => [c.id, c.name]));

const FEATURED_BANDS = [
  { slug:'kish', name:'Король и Шут', image:'images/pins/pins-126.jpg' },
  { slug:'metallica', name:'Metallica', image:'images/pins/pins-067.jpg' },
  { slug:'rammstein', name:'Rammstein', image:'images/pins/pins-090.jpg' },
  { slug:'nirvana', name:'Nirvana', image:'images/pins/pins-077.jpg' },
  { slug:'alisa', name:'Алиса', image:'images/pins/pins-118.jpg' },
  { slug:'kino', name:'Кино (Цой)', image:'images/pins/pins-136.jpg' }
];
const EXTRA_ALIASES = {
  kish:['киш','kish','korol-i-shut','король и шут','горшок'],
  kino:['цой','кино','tsoi','tsoy','виктор цой'],
  alisa:['алиса','alice'],
  metallica:['metallica','металлика'],
  rammstein:['rammstein','рамштайн','рамштейн'],
  nirvana:['nirvana','нирвана'],
  soad:['soad','system of a down'],
  rhcp:['rhcp','red hot chili peppers'],
  '5fdp':['5fdp','ffdp','five finger death punch'],
  bmth:['bmth','bring me the horizon'],
  acdc:['acdc','ac/dc','ac-dc'],
  leningrad:['ленинград','в питере пить','shnur','шнор']
};
// «Отрендеренные» копии фото (tools/enhance_images.py): images/<cat>/<id>.jpg → images/hd/<cat>/<id>.webp; при ошибке — оригинал
function hdImg(src){ return String(src||'').replace(/^images\/(keychains|magnets|pins|earrings)\/([^/]+)\.jpg$/i, 'images/hd/$1/$2.webp'); }
function imgTag(src, alt, extra){ const o = esc(src), h = esc(hdImg(src)); return `<img src="${h}" alt="${esc(alt||'')}" ${extra||''} onerror="if(this.src.indexOf('${o}')<0){this.src='${o}'}">`; }
function bandNameOf(p){ return p.band || String(p.name||'').replace(/\s+лого$/i,'').replace(/\s+[1-9]$/,'').trim(); }
function slugifyBand(name){
  const o = {'Король и Шут':'kish','Кино (Цой)':'kino','Алиса':'alisa','AC/DC':'acdc',"Guns N' Roses":'guns-n-roses','Red Hot Chili Peppers':'rhcp','System of a Down':'soad','Five Finger Death Punch':'5fdp','Bring Me The Horizon':'bmth','The Beatles':'beatles','The Offspring':'offspring','The Exploited':'exploited','The Rolling Stones':'rolling-stones','The Prodigy':'prodigy','Mötley Crüe':'motley-crue','Motörhead':'motorhead','W.A.S.P.':'wasp','Чиж & Co':'chizh','Lindemann':'lindemann','Ленинград':'leningrad','21 Pilots':'21-pilots'};
  if (o[name]) return o[name];
  const tr = {'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'j','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya','ö':'o','ü':'u','ä':'a','&':'and','/':'-'};
  return [...String(name).toLowerCase().replace(/ё/g,'е')].map(ch => tr[ch] ?? ch).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'band';
}
function bandSlugOf(p){ return p.bandSlug || slugifyBand(bandNameOf(p)); }
function bandSortKey(name){ return String(name).replace(/^The\s+/i,'').replace(/^[Ёё]/,'Е'); }
function bandLetter(name){
  const ch = bandSortKey(name).trim().charAt(0).toUpperCase();
  if (/[0-9]/.test(ch)) return '#';
  if (ch === 'Ё') return 'Е';
  if (/[A-ZА-Я]/.test(ch)) return ch;
  return '#';
}
function sortLetters(letters){
  const az = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ru = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';
  const rank = L => L === '#' ? '0' : az.includes(L) ? '1' + String(az.indexOf(L)).padStart(2,'0') : ru.includes(L) ? '2' + String(ru.indexOf(L)).padStart(2,'0') : '3'+L;
  return [...letters].sort((a,b) => rank(a).localeCompare(rank(b)));
}
function collectBands(){
  const map = new Map();
  for (const p of PRODUCTS){
    const name = bandNameOf(p), slug = bandSlugOf(p);
    if (!map.has(slug)) map.set(slug, {name, slug, aliases:new Set([name, slug]), count:0});
    const b = map.get(slug);
    b.count++;
    b.aliases.add(p.name);
    (EXTRA_ALIASES[slug]||[]).forEach(a => b.aliases.add(a));
  }
  const list = [...map.values()].sort((a,b) => bandSortKey(a.name).localeCompare(bandSortKey(b.name), 'ru', {sensitivity:'base'}));
  list.forEach(b => { b.aliases = [...b.aliases]; });
  return list;
}
const BANDS = collectBands();
const BAND_BY_SLUG = Object.fromEntries(BANDS.map(b => [b.slug, b]));
function normBandQ(s){ return String(s||'').trim().toLowerCase().replace(/ё/g,'е'); }
function resolveBandSlug(s){
  if (!s) return '';
  let raw; try { raw = decodeURIComponent(String(s)); } catch(e){ raw = String(s); }
  const q = normBandQ(raw), dash = q.replace(/\s+/g,'-');
  if (BAND_BY_SLUG[dash] || BAND_BY_SLUG[q]) return BAND_BY_SLUG[dash] ? dash : q;
  for (const b of BANDS){
    if (normBandQ(b.name) === q || b.slug === dash || b.slug === q) return b.slug;
    if (b.aliases.some(a => normBandQ(a) === q || normBandQ(a).replace(/\s+/g,'-') === dash)) return b.slug;
  }
  return '';
}

const LS_CART = 'merch_cart_v1', LS_HIST = 'merch_orders_v1', LS_MODE = 'merch_mode_v1', LS_RES = 'merch_reservations_v1', LS_INVSEQ = 'merch_invoice_seq_v1';
const PM = CFG.paymentMethods || {};
let mode = (() => { try { const m = localStorage.getItem(LS_MODE); return m === 'retail' || m === 'wholesale' ? m : null; } catch(e){ return null; } })();
const isRetail = () => mode === 'retail';
const MODE_NAME = {wholesale:'Опт', retail:'Розница'};
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => n.toLocaleString('ru-RU', {minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2}) + ' ₽';
const num = n => n.toLocaleString('ru-RU');
const r2 = n => Math.round(n * 100) / 100;
const unitWord = p => p.unit === 'комплект' ? 'компл.' : 'шт';

// ---------- stock ----------
// ---------- reservations (бронь) ----------
// Источники: reservations.js (из вкладки «Бронь», tools/sync_reservations.py), опубликованный CSV / Apps Script, и брони этого браузера.
let resRemote = [];
const resKey = r => r.orderId + '|' + r.productId;
function allReservations(){
  const m = new Map();
  for (const r of load(LS_RES, [])) m.set(resKey(r), r);
  for (const r of (window.RESERVATIONS || []).concat(resRemote)) m.set(resKey(r), r); // таблица главнее (там статус «оплачен»/«снята»)
  return [...m.values()];
}
function isActiveRes(r, now = Date.now()){ return String(r.status||'').toLowerCase().trim() === 'бронь' && new Date(r.expiresAt).getTime() > now && Number(r.qty) > 0; }
let resCache = null;
function resIndex(){
  if (resCache) return resCache;
  resCache = {};
  for (const r of allReservations()) if (isActiveRes(r)) {
    const x = resCache[r.productId] || (resCache[r.productId] = {qty:0, until:null});
    x.qty += Number(r.qty); const t = new Date(r.expiresAt); if (!x.until || t > x.until) x.until = t;
  }
  return resCache;
}
function resetRes(){ resCache = null; }
const ddmm = d => { const p = n => String(n).padStart(2,'0'); d = new Date(d); return `${p(d.getDate())}.${p(d.getMonth()+1)}`; };
function reservedOf(p){ return resIndex()[p.id] || {qty:0, until:null}; }
function available(p){ return Math.max(0, (p.stock > 0 ? p.stock : 0) - reservedOf(p).qty); }
function stockSplit(p, qty){ const st = available(p); const inStock = Math.min(qty, st); return {inStock, toOrder: qty - inStock}; }
function stockBadge(p){
  if (!(p.stock > 0)) return `<span class="stock order">Под заказ</span>`;
  const r = reservedOf(p), av = available(p);
  if (!r.qty) return `<span class="stock in">В наличии: ${num(p.stock)}</span>`;
  return av > 0 ? `<span class="stock in">К продаже: ${num(av)}</span>` : `<span class="stock order">Всё в брони</span>`;
}
function reservationNote(p){
  const r = reservedOf(p); if (!(p.stock > 0) || !r.qty) return '';
  return `<span class="stock-res">🔒 В наличии: ${num(p.stock)} шт (${num(r.qty)} забронировано до ${ddmm(r.until)}) — к продаже ${num(available(p))}</span>`;
}
function lineStockText(p, qty){
  const s = stockSplit(p, qty);
  if (!s.toOrder) return 'В наличии';
  if (!s.inStock) return `Под заказ · ${CFG.madeToOrderLead}`;
  return `${num(s.inStock)} в наличии + ${num(s.toOrder)} под заказ · ${CFG.madeToOrderLead}`;
}

// ---------- pricing ----------
function basePrice(p){
  if (isRetail()) { const rp = CFG.retailPrices || {default:600}; return rp[p.category] ?? rp.default; }
  return (CFG.prices[p.category] ?? p.price) + (p.twoClasp ? (CFG.twoClaspSurcharge||0) : 0);
}
function catPrice(cat){ return isRetail() ? ((CFG.retailPrices||{})[cat] ?? CFG.retailPrices.default) : CFG.prices[cat]; }
const minQty = () => isRetail() ? (CFG.retailMinOrderQty || 1) : CFG.minOrderQty;
const qStep = () => isRetail() ? 1 : 10;
function tierFor(qty){
  if (isRetail()) return qty > 0 ? {from:1, discount:0} : null;
  let t = null;
  for (const x of CFG.tiers) if (qty >= x.from) t = x;
  return t; // null if below minimum
}
function nextTier(qty){ return isRetail() ? null : (CFG.tiers.find(x => x.from > qty) || null); }
function calc(cart, pmId){
  const lines = Object.entries(cart).filter(([id,q]) => BY_ID[id] && q > 0).map(([id,q]) => ({p: BY_ID[id], qty: q}));
  const totalQty = lines.reduce((s,l) => s + l.qty, 0);
  const tier = tierFor(totalQty);
  const disc = tier ? tier.discount : 0;
  let subtotal = 0, total = 0;
  const byCat = {};
  for (const l of lines){
    l.base = basePrice(l.p);
    l.unitPrice = r2(l.base * (1 - disc/100));
    l.sum = r2(l.unitPrice * l.qty);
    subtotal += l.base * l.qty; total += l.sum;
    byCat[l.p.category] = (byCat[l.p.category]||0) + l.qty;
  }
  subtotal = r2(subtotal); total = r2(total);
  const pm = PM[pmId] || null, markupRate = pm ? (pm.markupRate || 0) : 0, markup = r2(total * markupRate);
  return {lines, totalQty, tier, disc, subtotal, total, discountSum: r2(subtotal - total), byCat,
          pm, markupRate, markup, grand: r2(total + markup),
          meetsMin: totalQty >= minQty(), next: nextTier(totalQty)};
}

// ---------- state ----------
let cart = load(LS_CART, {});
const pending = {}; // qty selected on cards not yet in cart
let activeCat = 'all', query = '', onlyStock = false, activeBand = '', bandQuery = '', sortMode = (() => { try { const v = localStorage.getItem('merch_sort'); return ['default','stock','alpha'].includes(v) ? v : 'default'; } catch(_) { return 'default'; } })();
function load(k, d){ try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch(e){ return d; } }
function save(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch(e){ console.warn(e); return false; } }
function setQty(id, q){
  q = Math.max(0, Math.min(100000, Math.round(Number(q)||0)));
  if (q > 0) cart[id] = q; else delete cart[id];
  save(LS_CART, cart); refreshCart(); refreshCard(id);
}

// ---------- contacts ----------
const ICO_TG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>';
const ICO_WA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>';
const ICO_MAIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>';
const ICO_PHONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>';
const ICO_OZON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17 6V5a5 5 0 0 0-10 0v1H5.2A1.2 1.2 0 0 0 4 7.25l1.3 13.1A1.5 1.5 0 0 0 6.8 21.5h10.4a1.5 1.5 0 0 0 1.5-1.15L20 7.25A1.2 1.2 0 0 0 18.8 6H17zM9 5a3 3 0 0 1 6 0v1H9V5zm3 5.2a1.1 1.1 0 0 1 1.1 1.1v3.4a1.1 1.1 0 1 1-2.2 0v-3.4A1.1 1.1 0 0 1 12 10.2z"/></svg>';
function telHref(phone){
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') return 'tel:+7' + d.slice(1);
  if (d.length === 11 && d[0] === '7') return 'tel:+' + d;
  if (d.length === 10) return 'tel:+7' + d;
  return d ? 'tel:+' + d : '';
}
function contactButtonItems(){
  const items = [];
  if (CFG.telegram) items.push(`<a class="contact-btn tg" href="${esc(CFG.telegram)}" target="_blank" rel="noopener noreferrer" aria-label="Telegram">${ICO_TG}<span>Telegram</span></a>`);
  if (CFG.whatsapp) items.push(`<a class="contact-btn wa" href="${esc(CFG.whatsapp)}" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp">${ICO_WA}<span>WhatsApp</span></a>`);
  if (CFG.email) items.push(`<a class="contact-btn mail" href="mailto:${esc(CFG.email)}" aria-label="Почта">${ICO_MAIL}<span>Почта</span></a>`);
  const tel = telHref(CFG.phone);
  if (CFG.phone && tel) items.push(`<a class="contact-btn phone" href="${esc(tel)}" aria-label="${esc(CFG.phone)}">${ICO_PHONE}<span>${esc(CFG.phone)}</span></a>`);
  if (CFG.ozon) items.push(`<a class="contact-btn ozon" href="${esc(CFG.ozon)}" target="_blank" rel="noopener noreferrer" aria-label="Мы на Ozon — отзывы покупателей" title="Мы на Ozon — отзывы покупателей">${ICO_OZON}<span>Мы на Ozon<span class="ozon-extra"> — отзывы покупателей</span></span></a>`);
  return items.join('');
}
function contactButtonsHTML(variant){
  return `<div class="contact-btns contact-btns-${variant}">${contactButtonItems()}</div>`;
}

// ---------- branding / static ----------
function initStatic(){
  const company = CFG.companyName;
  const brand = company && company !== 'Укажите контакты' ? company : 'Сувенирка';
  $('#brandName').textContent = brand;
  $('#footCompany').textContent = brand;
  const person = CFG.contactPerson && CFG.contactPerson !== 'Укажите контакты' ? CFG.contactPerson : '';
  const fp = $('#footPerson'); if (fp) fp.textContent = person ? ' · ' + person : '';
  const hc = $('#headerContacts'); if (hc) hc.innerHTML = contactButtonItems();
  const fc = $('#footContacts'); if (fc) { fc.className = 'contact-btns contact-btns-footer'; fc.innerHTML = contactButtonItems(); }
  $$('.maxkb').forEach(e => e.textContent = CFG.maxAttachmentKB);
  $$('.designFee').forEach(e => e.textContent = money(CFG.designFee));
  $$('.leadTime').forEach(e => e.textContent = CFG.madeToOrderLead);
  $$('.emailTo').forEach(e => e.textContent = CFG.email || 'нашу почту');
  // collage: six featured bands, each links to the catalog filtered by that band
  $('#heroCollage').innerHTML = FEATURED_BANDS.map(b =>
    `<a class="hero-band" href="#band=${encodeURIComponent(b.slug)}" title="${esc(b.name)}">
      ${imgTag(b.image, b.name, 'width="360" height="360" loading="lazy" decoding="async"')}
      <span>${esc(b.name)}</span>
    </a>`
  ).join('');
  renderFittings();
  // price cards
  $('#priceCards').innerHTML = CATS.slice(1).map(c => {
    const p = PRODUCTS.find(x => x.category === c.id); const cnt = PRODUCTS.filter(x => x.category === c.id).length;
    return `<a class="price-card" href="#catalog" data-goto-cat="${c.id}">${imgTag(p.image, '', 'loading="lazy"')}<div><span class="muted">${c.one}</span><b>${money(catPrice(c.id))}</b><span class="muted">${cnt} дизайнов · за ${c.id==='earrings'?'комплект':'шт'}</span></div></a>`;
  }).join('');
  $$('[data-goto-cat]').forEach(a => a.addEventListener('click', () => { activeCat = a.dataset.gotoCat; renderTabs(); renderGrid(); }));
  $('#tiersHome').innerHTML = CFG.tiers.map((t,i) => {
    const to = CFG.tiers[i+1] ? `–${num(CFG.tiers[i+1].from - 1)}` : '+';
    return `<div class="tier"><span class="muted">${num(t.from)}${to} шт</span><br><b>${t.discount ? '−' + t.discount + '%' : 'базовая цена'}</b></div>`;
  }).join('');
}

// ---------- catalog ----------
function renderTabs(){
  const pool = PRODUCTS.filter(p => (!activeBand || bandSlugOf(p) === activeBand));
  $('#tabs').innerHTML = CATS.map(c => {
    const n = c.id === 'all' ? pool.length : pool.filter(p => p.category === c.id).length;
    return `<button class="tab ${c.id===activeCat?'active':''}" data-cat="${c.id}">${c.name}<small>${n}</small></button>`;
  }).join('');
}
function filtered(){
  const q = query.trim().toLowerCase().replace(/ё/g,'е');
  return PRODUCTS.filter(p => (activeCat === 'all' || p.category === activeCat)
    && (!activeBand || bandSlugOf(p) === activeBand)
    && (!onlyStock || available(p) > 0)
    && (!q || p.name.toLowerCase().replace(/ё/g,'е').includes(q) || bandNameOf(p).toLowerCase().replace(/ё/g,'е').includes(q)));
}
// Сортировка: default — порядок каталога; stock — сначала в наличии (больше доступно → выше), под заказ/всё в брони — в конце; alpha — А–Я по группе, затем по названию
const COLL = new Intl.Collator('ru', {sensitivity:'base', numeric:true});
const PROD_ORDER = Object.fromEntries(PRODUCTS.map((p, i) => [p.id, i]));
function sorted(list){
  const byDefault = (a, b) => PROD_ORDER[a.id] - PROD_ORDER[b.id];
  const byAlpha = (a, b) => COLL.compare(bandSortKey(bandNameOf(a)), bandSortKey(bandNameOf(b))) || COLL.compare(a.name, b.name) || byDefault(a, b);
  if (sortMode === 'stock') return list.slice().sort((a, b) => (available(b) > 0) - (available(a) > 0) || available(b) - available(a) || byAlpha(a, b));
  if (sortMode === 'alpha') return list.slice().sort(byAlpha);
  return list;
}
function catalogTitle(){
  const el = $('#catalogTitle'); if (!el) return;
  const b = BAND_BY_SLUG[activeBand];
  el.textContent = b ? ('Каталог · ' + b.name) : 'Каталог';
}
function visibleBands(){
  const q = normBandQ(bandQuery);
  if (!q) return BANDS;
  return BANDS.filter(b => [b.name, b.slug, ...b.aliases].some(a => normBandQ(a).includes(q) || normBandQ(a).replace(/-/g,' ').includes(q)));
}
function chipHTML(b){
  return `<button type="button" class="band-chip ${b.slug===activeBand?'active':''}" data-band="${esc(b.slug)}">${esc(b.name)}<small>${b.count}</small></button>`;
}
function renderBandIndex(){
  const root = $('#bandIndex'); if (!root) return;
  const list = visibleBands();
  const allBtn = $('#bandAll'); if (allBtn) allBtn.classList.toggle('active', !activeBand);
  const lab = $('#bandActiveLabel');
  if (lab){
    const b = BAND_BY_SLUG[activeBand];
    lab.hidden = !b;
    if (b) lab.textContent = b.name + ' · ' + b.count;
  }
  const total = $('#bandTotal'); if (total) total.textContent = String(BANDS.length);
  catalogTitle();
  const groups = new Map();
  for (const b of list){
    const L = bandLetter(b.name);
    if (!groups.has(L)) groups.set(L, []);
    groups.get(L).push(b);
  }
  const order = sortLetters([...groups.keys()]);
  const letters = $('#bandLetters');
  if (letters) letters.innerHTML = order.map(L => `<button type="button" data-jump="${esc(L)}" aria-label="Буква ${esc(L)}">${esc(L)}</button>`).join('');
  const scroller = $('#bandScroller');
  if (scroller) scroller.innerHTML = list.map(chipHTML).join('');
  const body = $('#bandIndexBody');
  if (body) body.innerHTML = list.length
    ? order.map(L => `<div class="band-letter" data-letter="${esc(L)}"><div class="band-letter-key">${esc(L)}</div><div class="band-letter-chips">${groups.get(L).map(chipHTML).join('')}</div></div>`).join('')
    : '<p class="band-empty">Нет групп по запросу. Попробуйте другое название или сбросьте фильтр.</p>';
}
function setBand(slug){
  activeBand = resolveBandSlug(slug);
  const hash = activeBand ? '#band=' + encodeURIComponent(activeBand) : '#catalog';
  if (location.hash !== hash) location.hash = hash;
  else { renderBandIndex(); renderTabs(); renderGrid(); }
}
function bindBandIndex(){
  const root = $('#bandIndex'); if (!root) return;
  $('#bandToggle')?.addEventListener('click', () => {
    const open = !root.classList.contains('open');
    root.classList.toggle('open', open);
    $('#bandToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  let t;
  $('#bandSearch')?.addEventListener('input', e => {
    clearTimeout(t);
    t = setTimeout(() => { bandQuery = e.target.value; renderBandIndex(); }, 80);
  });
  root.addEventListener('click', e => {
    const jump = e.target.closest('[data-jump]');
    if (jump){
      root.classList.add('open');
      $('#bandToggle')?.setAttribute('aria-expanded','true');
      const row = root.querySelector('.band-letter[data-letter="' + CSS.escape(jump.dataset.jump) + '"]');
      if (row) row.scrollIntoView({block:'nearest', behavior:'smooth'});
      return;
    }
    const chip = e.target.closest('[data-band]');
    if (!chip) return;
    setBand(chip.dataset.band || '');
  });
}
function cardHTML(p){
  const inCart = cart[p.id] > 0;
  const q = inCart ? cart[p.id] : (pending[p.id] ?? (isRetail() ? 1 : 50));
  const st = qStep(), quick = isRetail() ? [1,5,10] : [50,100,500];
  return `<article class="item ${inCart?'in-cart':''}" data-id="${p.id}">
    <div class="ph" data-zoom="${p.id}">${imgTag(p.image, p.name, 'loading="lazy" decoding="async" width="360" height="360"')}${stockBadge(p)}</div>
    <div class="body">
      <span class="cat">${esc(CATS.find(c=>c.id===p.category).one)}</span>
      <span class="name">${esc(p.name)}</span>
      <span class="price">${money(basePrice(p))} <small>/ ${p.unit === 'комплект' ? 'компл. (2 шт)' : 'шт'}</small></span>
      ${reservationNote(p)}
      ${available(p) > 0 ? '' : `<span class="stock-note">Изготовление ${esc(CFG.madeToOrderLead)}</span>`}
      ${!isRetail() && p.twoClasp && CFG.twoClaspSurcharge ? `<span class="note">На двух цангах (+${CFG.twoClaspSurcharge} ₽)</span>` : ''}
      <div class="actions">
        <div class="stepper"><button type="button" data-step="-${st}" aria-label="Меньше">−</button><input type="number" min="0" step="${st}" value="${q}" data-qty aria-label="Количество"><button type="button" data-step="${st}" aria-label="Больше">+</button></div>
        <div class="quick">${quick.map(n => `<button type="button" data-plus="${n}">+${n}</button>`).join('')}</div>
        ${inCart ? `<button class="btn add" data-remove>✓ В корзине · убрать</button>` : `<button class="btn primary add" data-add>В корзину</button>`}
      </div>
    </div></article>`;
}
function renderGrid(){
  const list = sorted(filtered());
  $('#grid').innerHTML = list.map(cardHTML).join('');
  const empty = $('#gridEmpty');
  empty.hidden = list.length > 0;
  if (!list.length){
    const b = BAND_BY_SLUG[activeBand];
    empty.innerHTML = b
      ? `В группе «${esc(b.name)}» ничего не найдено. <button type="button" class="linkish" data-band="">Все группы</button> или <a href="#custom">закажите дизайн</a>.`
      : 'Ничего не найдено. Не нашли нужную группу? <a href="#custom">Закажите дизайн</a> — сделаем.';
  }
}
function refreshCard(id){
  const el = $(`.item[data-id="${id}"]`);
  if (el) el.outerHTML = cardHTML(BY_ID[id]);
}
function bindGrid(){
  const grid = $('#grid');
  grid.addEventListener('click', e => {
    const card = e.target.closest('.item'); if (!card) return;
    const id = card.dataset.id, p = BY_ID[id], inCart = cart[id] > 0;
    const input = $('[data-qty]', card);
    const cur = Number(input.value) || 0;
    const apply = v => { v = Math.max(0, v); if (inCart) setQty(id, v); else { pending[id] = v; input.value = v; } };
    if (e.target.closest('[data-zoom]')) return zoom(p);
    if (e.target.dataset.step) apply(cur + Number(e.target.dataset.step));
    else if (e.target.dataset.plus) apply(cur + Number(e.target.dataset.plus) - (inCart || pending[id] !== undefined ? 0 : cur));
    else if (e.target.hasAttribute('data-add')) { if (cur <= 0) { toast('Укажите количество'); return; } setQty(id, cur); delete pending[id]; toast(`«${p.name}» — ${num(cur)} ${unitWord(p)} в корзине`); }
    else if (e.target.hasAttribute('data-remove')) { setQty(id, 0); }
  });
  grid.addEventListener('change', e => {
    if (!e.target.matches('[data-qty]')) return;
    const id = e.target.closest('.item').dataset.id; const v = Math.max(0, Math.round(Number(e.target.value)||0));
    if (cart[id] > 0) setQty(id, v); else { pending[id] = v; e.target.value = v; }
  });
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (!b) return; activeCat = b.dataset.cat; renderTabs(); renderGrid(); });
  $('#onlyStock').addEventListener('change', e => { onlyStock = e.target.checked; renderGrid(); });
  const ss = $('#sortSel'); if (ss) { ss.value = sortMode;
    ss.addEventListener('change', e => { sortMode = e.target.value; try { localStorage.setItem('merch_sort', sortMode); } catch(_){} renderGrid(); }); }
  let t; $('#search').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { query = e.target.value; renderGrid(); }, 120); });
  $('#gridEmpty').addEventListener('click', e => { const b = e.target.closest('[data-band]'); if (b) setBand(b.dataset.band || ''); });
}
function zoom(p){
  const d = document.createElement('div'); d.className = 'lightbox';
  d.innerHTML = `<div>${imgTag(p.image, '')}<div>${esc(p.name)} · ${esc(CATS.find(c=>c.id===p.category).one)}</div></div>`;
  d.onclick = () => d.remove(); document.body.appendChild(d);
}
function renderFittings(){
  const photos = CFG.fittingsPhotos || [];
  const box = $('#fittingsShowcase');
  if (!box) return;
  box.hidden = photos.length === 0;
  const grid = $('#fittingsGrid');
  if (grid) grid.innerHTML = photos.map((p, i) =>
    `<button type="button" class="fittings-card" data-fit="${i}" aria-label="${esc(p.caption)} — увеличить">
      <img src="${esc(p.src)}" alt="${esc(p.alt || p.caption)}" width="747" height="1000" loading="lazy" decoding="async">
      <span>${esc(p.caption)}</span>
    </button>`
  ).join('');
  const oz = $('#fittingsOzon');
  if (oz) {
    if (CFG.ozon) { oz.href = CFG.ozon; oz.hidden = false; }
    else { oz.removeAttribute('href'); oz.hidden = true; }
  }
}
function bindFittings(){
  const grid = $('#fittingsGrid');
  if (!grid || grid.dataset.bound) return;
  grid.dataset.bound = '1';
  grid.addEventListener('click', e => {
    const btn = e.target.closest('[data-fit]');
    if (!btn) return;
    const p = (CFG.fittingsPhotos || [])[Number(btn.dataset.fit)];
    if (p) openLightbox(p.src, p.caption);
  });
}
function openLightbox(src, caption){
  $('.lightbox')?.remove();
  const d = document.createElement('div');
  d.className = 'lightbox';
  d.setAttribute('role', 'dialog');
  d.setAttribute('aria-label', caption || 'Увеличенное фото');
  d.innerHTML = `<div><img src="${esc(src)}" alt="${esc(caption || '')}">${caption ? `<div>${esc(caption)}</div>` : ''}</div>`;
  d.onclick = () => d.remove();
  document.body.appendChild(d);
}

// ---------- progress / cart ----------
function progressHTML(c){
  if (isRetail()) return `<div><b>${num(c.totalQty)} шт</b> · розничные цены: ${money(CFG.retailPrices.default)} / шт, серьги ${money(CFG.retailPrices.earrings)} / компл.</div>`;
  const max = CFG.tiers[CFG.tiers.length-1].from;
  let msg;
  if (!c.meetsMin) msg = `<b>${num(c.totalQty)} / ${num(CFG.minOrderQty)} шт</b> — до минимального заказа ещё <b>${num(CFG.minOrderQty - c.totalQty)} шт</b>`;
  else if (c.next) msg = `<b>${num(c.totalQty)} шт</b> · скидка <b>${c.disc}%</b> — ещё <b>${num(c.next.from - c.totalQty)} шт</b> до скидки ${c.next.discount}%`;
  else msg = `<b>${num(c.totalQty)} шт</b> · максимальная скидка <b>${c.disc}%</b> 🎉`;
  const target = c.meetsMin ? (c.next ? c.next.from : max) : CFG.minOrderQty;
  const pct = Math.min(100, c.totalQty / target * 100);
  return `<div>${msg}</div><div class="progress ${c.meetsMin?'ok':''}"><i style="width:${pct}%"></i></div>
    <div class="tier-row">${CFG.tiers.map(t => `<span class="tier-chip ${c.totalQty>=t.from?'on':''}">от ${num(t.from)}: ${t.discount?'−'+t.discount+'%':'база'}</span>`).join('')}</div>`;
}
function totalsHTML(c){
  const cats = Object.entries(c.byCat).map(([k,v]) => `${CAT_NAME[k]}: ${num(v)}`).join(' · ');
  return `<div class="totals">
    <span>Позиций</span><span>${c.lines.length}</span>
    <span>Всего изделий</span><span>${num(c.totalQty)} шт</span>
    <span>${isRetail() ? 'Сумма' : 'Сумма без скидки'}</span><span>${money(c.subtotal)}</span>
    ${isRetail() ? '' : `<span class="disc">Скидка ${c.disc}%</span><span class="disc">−${money(c.discountSum)}</span>`}
    ${c.pm && c.markup ? `<span>Товары</span><span>${money(c.total)}</span><span class="markup">${esc(c.pm.markupLabel)}</span><span class="markup">+${money(c.markup)}</span>` : ''}
    <span class="grand">Итого${c.pm ? ' к оплате' : ''}</span><span class="grand">${money(c.grand)}</span>
  </div>${c.pm ? `<div class="by-cat">Оплата: ${esc(c.pm.label)}${c.markup ? '' : ' — без надбавок'}</div>` : ''}${cats ? `<div class="by-cat">${cats}</div>` : ''}`;
}
function refreshCart(){
  const c = calc(cart);
  $('#cartCount').textContent = num(c.totalQty);
  $('#miniProgress').innerHTML = progressHTML(c) ;
  $('#cartItems').innerHTML = c.lines.length ? c.lines.map(l => `
    <div class="line" data-id="${l.p.id}">
      ${imgTag(l.p.image, '', 'loading="lazy"')}
      <div><div class="ln-name">${esc(l.p.name)}</div><div class="ln-meta">${esc(CATS.find(x=>x.id===l.p.category).one)} · ${money(l.unitPrice)}${c.disc?` <s>${money(l.base)}</s>`:''} / ${unitWord(l.p)}</div><div class="ln-meta"><b>${money(l.sum)}</b></div><div class="ln-stock"><span class="stock ${stockSplit(l.p,l.qty).toOrder?'order':'in'}">${esc(lineStockText(l.p,l.qty))}</span></div></div>
      <div class="ln-right"><div class="stepper"><button data-cstep="-10">−</button><input type="number" min="0" value="${l.qty}" data-cqty><button data-cstep="10">+</button></div><button class="rm" data-crm>Удалить</button></div>
    </div>`).join('') : `<p class="empty">Корзина пуста.<br><a href="#catalog" data-close>Перейти в каталог</a></p>`;
  $('#cartFoot').innerHTML = progressHTML(c) + totalsHTML(c) +
    (c.lines.length && !c.meetsMin ? `<div class="warn">Минимальный заказ — ${num(minQty())} шт суммарно (можно миксом). Добавьте ещё ${num(minQty() - c.totalQty)} шт.</div>` : '') +
    (c.lines.length ? `<div class="hint-box dlv-box">🚚 ${esc(DLV_NOTICE)}</div>` : '') +
    `<button class="btn primary big" id="toCheckout" ${c.meetsMin?'':'disabled'}>Оформить заказ</button>` +
    (c.lines.length ? `<button class="btn ghost" id="clearCart">Очистить</button>` : '');
  if (location.hash === '#checkout') renderCheckoutSummary();
}
function bindCart(){
  $('#cartBtn').onclick = openDrawer; $('#drawerClose').onclick = closeDrawer; $('#overlay').onclick = closeDrawer;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawer(); $('.lightbox')?.remove(); } });
  $('#drawer').addEventListener('click', e => {
    if (e.target.closest('[data-close]')) return closeDrawer();
    if (e.target.id === 'toCheckout') { closeDrawer(); location.hash = '#checkout'; return; }
    if (e.target.id === 'clearCart') { if (confirm('Очистить корзину?')) { const ids = Object.keys(cart); cart = {}; save(LS_CART, cart); refreshCart(); ids.forEach(refreshCard); } return; }
    const line = e.target.closest('.line'); if (!line) return; const id = line.dataset.id;
    if (e.target.dataset.cstep) setQty(id, (cart[id]||0) + Number(e.target.dataset.cstep) * qStep() / 10);
    if (e.target.hasAttribute('data-crm')) setQty(id, 0);
  });
  $('#drawer').addEventListener('change', e => { if (e.target.matches('[data-cqty]')) setQty(e.target.closest('.line').dataset.id, e.target.value); });
}
function openDrawer(){ $('#drawer').classList.add('open'); $('#overlay').hidden = false; $('#drawer').setAttribute('aria-hidden','false'); }
function closeDrawer(){ $('#drawer').classList.remove('open'); $('#overlay').hidden = true; $('#drawer').setAttribute('aria-hidden','true'); }

// ---------- delivery / consents ----------
const DLV = CFG.deliveryServices || [];
const DLV_BY = Object.fromEntries(DLV.map(d => [d.id, d]));
const DLV_NOTICE = CFG.deliveryNotice || 'Доставка не входит в счёт — оплачивается получателем при получении по тарифу службы.';
const selectedDlv = () => { const i = $('#orderForm input[name=delivery]:checked'); return i ? DLV_BY[i.value] || null : null; };
const ADDR_LABEL = {pvz:'Адрес пункта выдачи *', courier:'Адрес для курьера (улица, дом, квартира) *', post:'Адрес получения: улица, дом, кв. или «до востребования» *'};
const ADDR_PH = {pvz:'Скопируйте адрес выбранного пункта с карты', courier:'ул. Ленина, д. 1, кв. 10', post:'ул. Ленина, д. 1, кв. 10'};
function renderDeliveryOptions(){
  $('#deliveryNotice').innerHTML = `🚚 <b>Доставка оплачивается отдельно.</b> ${esc(DLV_NOTICE)}`;
  $('#deliveryOptions').innerHTML = DLV.map(d => `<label class="pay-opt dlv-opt"><input type="radio" name="delivery" value="${esc(d.id)}" required>
    <span><b>${esc(d.name)}</b><small>${esc(d.hint || '')}</small>${d.kind !== 'pickup' ? '<em>оплата доставки — получателем</em>' : ''}</span></label>`).join('');
}
function updateDeliveryFields(){
  const d = selectedDlv(), f = $('#orderForm'), box = $('#deliveryFields');
  box.hidden = !d;
  const k = d ? d.kind : '';
  const show = (key, on) => $$(`[data-dlv="${key}"]`, box).forEach(l => { l.hidden = !on; const i = $('input', l); i.required = !!d && on; if (!on) i.classList.remove('invalid'); });
  show('city', k && k !== 'pickup'); show('address', k && k !== 'pickup'); show('index', k === 'post'); show('recipient', !!k);
  if (!d) return;
  if (k !== 'pickup'){ $('#dlvAddressLabel').textContent = ADDR_LABEL[k] || 'Адрес *'; f.elements.dlvAddress.placeholder = ADDR_PH[k] || ''; }
  $('#deliveryMap').innerHTML = d.mapUrl
    ? `<a class="btn map-btn" href="${esc(d.mapUrl)}" target="_blank" rel="noopener noreferrer">🗺 ${esc(d.mapLabel || 'Карта пунктов')}</a><span class="muted">${k === 'courier' ? 'Укажите адрес, куда привезти посылку.' : k === 'post' ? 'Найдите отделение и его индекс на карте Почты.' : 'Выберите удобный пункт на карте и вставьте его адрес ниже.'}</span>`
    : `<span class="muted">📍 Склад: ${esc(CFG.shipFrom || 'г. Павловск')}. Время и адрес выдачи согласуем в мессенджере после оплаты.</span>`;
  prefillRecipient();
}
function prefillRecipient(){
  const f = $('#orderForm');
  [['dlvName','name'],['dlvPhone','phone']].forEach(([to, from]) => { const t = f.elements[to]; if (!t.dataset.touched) t.value = f.elements[from].value; });
}
function deliveryOf(f){
  const d = selectedDlv(); if (!d) return null;
  const v = n => (f.elements[n] && f.elements[n].value || '').trim();
  const pick = d.kind === 'pickup';
  return {serviceId:d.id, service:d.name, kind:d.kind, city: pick ? 'Павловск' : v('dlvCity'), address: pick ? 'самовывоз со склада (по договорённости)' : v('dlvAddress'),
    postIndex: d.kind === 'post' ? v('dlvIndex') : '', recipientName:v('dlvName'), recipientPhone:v('dlvPhone'), comment:v('dlvComment'),
    payer: pick ? 'самовывоз' : 'получатель — при получении, по тарифу службы', shipFrom: CFG.shipFrom || 'г. Павловск', trackNumber:''};
}
function deliveryText(dl){
  if (!dl) return '';
  return [dl.service, [dl.postIndex, dl.city, dl.address].filter(Boolean).join(', '), `получатель: ${dl.recipientName}, ${dl.recipientPhone}`,
    dl.comment && `комментарий: ${dl.comment}`, dl.kind !== 'pickup' && 'доставку оплачивает получатель'].filter(Boolean).join('; ');
}
function consentText(cs){
  if (!cs) return '';
  return `Согласия: ПД — ${cs.personalData ? 'да' : 'нет'}, условия — ${cs.terms ? 'да' : 'нет'}, рассылка — ${cs.marketing ? 'да' : 'нет'} (${fmtDT(cs.acceptedAt)}, ред. ${cs.docsVersion})`;
}
const consentsOk = () => $$('#orderForm [data-consent]').every(i => i.checked);
function updateSubmitState(c){
  c = c || calc(cart, selectedPm());
  const ok = consentsOk();
  $('#orderSubmit').disabled = !c.meetsMin || !ok;
  $('#submitHint').textContent = c.meetsMin && !ok ? 'Отметьте обязательные согласия (*), чтобы оформить заказ.' : '';
}

// ---------- checkout ----------
function summaryTable(lines){
  const row = l => `<tr><td>${esc(l.name)} <span class="muted">· ${esc(l.categoryName)}</span>${l.availability==='частично в наличии' ? `<br><span class="stock order">${num(l.inStockQty)} в наличии + ${num(l.madeToOrderQty)} под заказ</span>` : ''}</td><td class="r">${num(l.qty)}</td><td class="r">${money(l.unitPrice)}</td><td class="r">${money(l.sum)}</td></tr>`;
  const inS = lines.filter(l => !l.madeToOrderQty), ord = lines.filter(l => l.madeToOrderQty);
  const grp = (title, arr) => arr.length ? `<tr class="sum-group"><td colspan="4">${title} · ${arr.length} поз., ${num(arr.reduce((a,l)=>a+l.qty,0))} шт</td></tr>` + arr.map(row).join('') : '';
  return `<div class="sum-scroll"><table class="sum-table"><thead><tr><th>Позиция</th><th class="r">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th></tr></thead><tbody>
    ${grp('✅ В наличии — отгрузка со склада', inS)}${grp(`🛠 Под заказ — изготовление ${esc(CFG.madeToOrderLead)}`, ord)}
  </tbody></table></div>`;
}
function orderLines(c){
  return c.lines.map(l => ({id:l.p.id, name:l.p.name, category:l.p.category, categoryName:CATS.find(x=>x.id===l.p.category).one,
    unit:l.p.unit, qty:l.qty, basePrice:l.base, unitPrice:l.unitPrice, sum:l.sum, image:l.p.image, twoClasp: !!l.p.twoClasp, ...availability(l.p, l.qty)}));
}
function availability(p, qty){
  const s = stockSplit(p, qty);
  return {stock: p.stock ?? null, inStockQty: s.inStock, madeToOrderQty: s.toOrder,
          availability: s.toOrder ? (s.inStock ? 'частично в наличии' : 'под заказ') : 'в наличии'};
}
const selectedPm = () => { const i = $('#orderForm input[name=payment]:checked'); return i ? i.value : ''; };
function renderPaymentOptions(){
  $('#payOptions').innerHTML = Object.values(PM).map(m => `<label class="pay-opt"><input type="radio" name="payment" value="${m.id}" required>
    <span><b>${esc(m.label)}</b><small>${esc(m.legalName)}</small><em>${esc(m.hint || '')}</em></span></label>`).join('');
}
function deliverySummaryHTML(){
  const d = selectedDlv();
  return `<div class="hint-box dlv-box">🚚 ${d ? `Доставка: <b>${esc(d.name)}</b>. ` : '<b>Выберите способ доставки.</b> '}${esc(DLV_NOTICE)}</div>`;
}
function renderCheckoutSummary(){
  const pmId = selectedPm();
  const c = calc(cart, pmId);
  $$('.payer-legal').forEach(e => e.hidden = !(pmId === 'ooo' || pmId === 'ip'));
  $('#checkoutSummary').innerHTML = `<h3>Состав заказа</h3>` + (c.lines.length ? summaryTable(orderLines(c)) : '<p class="muted">Корзина пуста.</p>') +
    progressHTML(c) + '<br>' + totalsHTML(c) +
    (!pmId ? `<div class="hint-box">Выберите способ оплаты — итог пересчитается, после отправки сразу сформируется счёт.</div>` : '') +
    (c.lines.some(l => stockSplit(l.p, l.qty).inStock) ? `<div class="hint-box">🔒 Позиции из наличия будут забронированы на ${CFG.reservationDays||1} день — до ${ddmm(reservationUntil())} включительно. Если оплата не поступит, бронь снимается.</div>` : '') +
    (!c.meetsMin ? `<br><div class="warn">Нельзя отправить: минимальный заказ ${num(minQty())} шт, сейчас ${num(c.totalQty)} шт. <a href="#catalog">Добавить позиции</a></div>` : '') +
    deliverySummaryHTML() +
    `<p><button class="btn ghost" type="button" id="editCart">Изменить состав</button></p>`;
  $('#editCart').onclick = openDrawer;
  updateSubmitState(c);
}
function validate(form, errBox, extra){
  let ok = true, missing = false; const errs = [];
  $$('input,textarea', form).forEach(i => i.classList.remove('invalid'));
  $$('[required]', form).forEach(i => {
    const bad = i.type === 'checkbox' ? !i.checked : !i.value.trim();
    if (bad){ ok = false; missing = true; i.classList.add('invalid'); }
  });
  const email = form.elements.email; if (email.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)){ ok=false; email.classList.add('invalid'); errs.push('Проверьте email'); }
  const phone = form.elements.phone; if (phone.value && phone.value.replace(/\D/g,'').length < 10){ ok=false; phone.classList.add('invalid'); errs.push('Проверьте телефон'); }
  if (extra){ const m = extra(); if (m){ ok=false; errs.push(m); } }
  if (missing) errs.unshift('Заполните обязательные поля (*)');
  errBox.textContent = ok ? '' : errs.join('. ');
  if (!ok) $('.invalid', form)?.focus();
  return ok;
}
const contactOf = f => ({name:f.elements.name.value.trim(), phone:f.elements.phone.value.trim(), email:f.elements.email.value.trim(), company:f.elements.company.value.trim()});
function newId(prefix){
  const d = new Date(), p = n => String(n).padStart(2,'0');
  return `${prefix}-${d.getFullYear()%100}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${Math.random().toString(36).slice(2,5).toUpperCase()}`;
}
function reservationUntil(from = new Date()){
  const d = new Date(from); d.setDate(d.getDate() + (CFG.reservationDays || 1)); d.setHours(23, 59, 59, 0); return d;
}
function nextInvoiceNo(d = new Date()){
  const p = n => String(n).padStart(2,'0'), day = `${p(d.getDate())}${p(d.getMonth()+1)}${d.getFullYear()%100}`;
  const st = load(LS_INVSEQ, {}); const n = (st.day === day ? st.n : 0) + 1; save(LS_INVSEQ, {day, n});
  return `${day}-${String(n).padStart(3,'0')}${Math.random().toString(36).slice(2,4).toUpperCase()}`;
}
// Старый (уже развёрнутый) Code.gs пишет o.comment в колонку «Комментарий» — кладём туда читаемую сводку доставки и согласий
function sheetComment(o){
  return [o.comment, o.delivery && 'ДОСТАВКА: ' + deliveryText(o.delivery), consentText(o.consents)].filter(Boolean).join(' | ');
}
function pushToSheet(o){
  if (!CFG.appsScriptUrl) return;
  let body = '';
  try { body = JSON.stringify({action:'order', order:{...o, customerComment:o.comment || '', comment:sheetComment(o), items:o.items.map(({image, ...x}) => x)}, invoiceHtml: invoiceHTML(o)}); }
  catch(e){ console.warn('Apps Script payload', e); return; }
  // 1) основной канал — fetch (text/plain, no-cors)
  try { fetch(CFG.appsScriptUrl, {method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain;charset=utf-8'}, body}).catch(err => console.warn('Apps Script fetch', err)); }
  catch(e){ console.warn('Apps Script fetch', e); }
  // 2) резервный канал — обычная HTML-форма с полем payload в скрытый iframe (не зависит от fetch/CORS/блокировщиков).
  //    Скрипт пропускает повтор по номеру заказа, так что двойной записи не будет.
  setTimeout(() => {
    try {
      const name = 'gsSink' + Date.now();
      const fr = document.createElement('iframe'); fr.name = name; fr.hidden = true; fr.setAttribute('aria-hidden', 'true'); fr.tabIndex = -1;
      const fm = document.createElement('form'); fm.method = 'POST'; fm.action = CFG.appsScriptUrl; fm.target = name; fm.hidden = true; fm.acceptCharset = 'UTF-8';
      const inp = document.createElement('input'); inp.type = 'hidden'; inp.name = 'payload'; inp.value = body; fm.appendChild(inp);
      document.body.append(fr, fm); fm.submit();
      setTimeout(() => { fr.remove(); fm.remove(); }, 60000);
    } catch(e){ console.warn('Apps Script form', e); }
  }, 1500);
}
function bindOrderForm(){
  const f = $('#orderForm');
  renderPaymentOptions(); renderDeliveryOptions(); updateDeliveryFields();
  f.addEventListener('change', e => {
    if (e.target.name === 'payment') { renderCheckoutSummary(); refreshCart(); }
    if (e.target.name === 'delivery') { updateDeliveryFields(); renderCheckoutSummary(); }
    if (e.target.hasAttribute('data-consent')) updateSubmitState();
  });
  f.addEventListener('input', e => {
    if (e.target.name === 'dlvName' || e.target.name === 'dlvPhone') e.target.dataset.touched = e.target.value ? '1' : '';
    if (e.target.name === 'name' || e.target.name === 'phone') prefillRecipient();
  });
  f.addEventListener('submit', e => {
    e.preventDefault();
    const pmId = selectedPm();
    const c = calc(cart, pmId);
    const dSel = selectedDlv();
    if (!validate(f, $('#orderError'), () => {
      if (!c.meetsMin) return `Минимальный заказ ${minQty()} шт — сейчас ${c.totalQty} шт`;
      if (!pmId) return 'Выберите способ оплаты';
      if (!dSel) return 'Выберите способ доставки';
      if (dSel.kind === 'post' && !/^\d{6}$/.test(f.elements.dlvIndex.value.trim())) { f.elements.dlvIndex.classList.add('invalid'); return 'Индекс — 6 цифр'; }
      if (f.elements.dlvPhone.value.replace(/\D/g,'').length < 10) { f.elements.dlvPhone.classList.add('invalid'); return 'Проверьте телефон получателя'; }
      if (!consentsOk()) return 'Отметьте обязательные согласия';
      return '';
    })) return;
    const delivery = deliveryOf(f);
    const now = new Date(), until = reservationUntil(now), pm = PM[pmId];
    const items = orderLines(c);
    const order = {type:'catalog', typeName:'Заказ из каталога', id:newId('ZK'), createdAt:now.toISOString(),
      mode, modeName: MODE_NAME[mode],
      contact:{...contactOf(f), city:delivery.city, inn:(f.elements.payerInn?.value||'').trim(), requisites:(f.elements.payerReq?.value||'').trim()},
      comment:f.elements.comment.value.trim(),
      delivery,
      consents:{personalData:f.elements.consentPd.checked, terms:f.elements.consentTerms.checked, marketing:f.elements.consentAds.checked,
        acceptedAt:now.toISOString(), docsVersion:(CFG.legalDocs || {}).version || '', docs:['consent.html','privacy.html','terms.html']},
      payment:{id:pm.id, label:pm.label, legalName:pm.legalName, markupRate:c.markupRate, markupLabel:pm.markupLabel||''},
      invoice:{number:nextInvoiceNo(now), date:now.toISOString(), payUntil:until.toISOString()},
      items, totals:{totalQty:c.totalQty, discountPercent:c.disc, subtotal:c.subtotal, discount:c.discountSum, total:c.total,
        markupRate:c.markupRate, markup:c.markup, grand:c.grand, currency:'RUB'},
      reservation:{status:'бронь', expiresAt:until.toISOString(),
        lines: items.filter(i => i.inStockQty > 0).map(i => ({productId:i.id, productName:i.name, category:i.category, qty:i.inStockQty, stockRows: BY_ID[i.id].stockRows || []}))},
      seller:{company:CFG.companyName, email:CFG.email}};
    // бронь — сразу уменьшает «к продаже» на карточках
    const res = load(LS_RES, []);
    for (const l of order.reservation.lines) res.push({orderId:order.id, dateIssued:order.createdAt, expiresAt:order.reservation.expiresAt, ...l,
      status:'бронь', paymentMethod:pm.label, customer:order.contact.company || order.contact.name});
    save(LS_RES, res.filter(r => isActiveRes(r) || r.orderId === order.id)); resetRes();
    addHistory(order);
    pushToSheet(order);
    const w = openInvoice(order); // печатная форма счёта открывается автоматически
    cart = {}; save(LS_CART, cart); refreshCart(); renderGrid(); f.reset();
    $$('[data-touched]', f).forEach(i => delete i.dataset.touched); updateDeliveryFields(); renderCheckoutSummary();
    showSuccess(order, !w);
  });
}

// ---------- custom design ----------
let customFiles = [];
function designCount(){ return Math.max(1, Math.round(Number($('#designCount').value) || 1)); }
function updateFee(){ const n = designCount(); $('#feeCalc').innerHTML = `Разработка: ${n} × ${money(CFG.designFee)} = <b>${money(n * CFG.designFee)}</b> <span class="muted">· изделия — по ценам каталога</span>`; }
function bindCustomForm(){
  const f = $('#customForm'), inp = $('#customFiles'), maxB = CFG.maxAttachmentKB * 1024;
  const readFile = file => new Promise(res => {
    const base = {name:file.name, size:file.size, type:file.type, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : ''};
    if (!file.type.startsWith('image/')) return res({...base, included:false, note:'Не изображение — приложите к письму'});
    if (file.size > maxB) return res({...base, included:false, note:`Больше ${CFG.maxAttachmentKB} КБ — приложите к письму`});
    const r = new FileReader(); r.onload = () => res({...base, included:true, dataUrl:r.result}); r.onerror = () => res({...base, included:false, note:'Не удалось прочитать'}); r.readAsDataURL(file);
  });
  const renderFiles = () => { $('#fileList').innerHTML = customFiles.map((x,i) => `<div class="thumb ${x.included?'':'skip'}">${x.preview?`<img src="${x.preview}" alt="">`:''}<div>${esc(x.name)} · ${Math.round(x.size/1024)} КБ</div><div>${x.included?'✓ в файле заявки':'⚠ '+esc(x.note)}</div><button type="button" class="x" data-rmfile="${i}">убрать</button></div>`).join(''); };
  const addFiles = async files => { customFiles = customFiles.concat(await Promise.all([...files].map(readFile))); renderFiles(); };
  inp.addEventListener('change', async () => { await addFiles(inp.files); inp.value = ''; });
  $('#fileList').addEventListener('click', e => { const i = e.target.dataset.rmfile; if (i === undefined) return; customFiles.splice(Number(i), 1); renderFiles(); });
  const zone = $('#uploadZone');
  ['dragenter','dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', e => addFiles(e.dataTransfer.files));
  $('#designCount').addEventListener('input', updateFee); updateFee();
  f.addEventListener('submit', e => {
    e.preventDefault();
    const types = $$('input[name=types]:checked', f).map(i => i.value);
    if (!validate(f, $('#customError'), () => types.length ? '' : 'Выберите хотя бы один тип изделий')) return;
    const qty = Number(f.elements.qty.value) || null;
    const order = {type:'custom', typeName:'Индивидуальный дизайн', id:newId('ID'), createdAt:new Date().toISOString(),
      contact:contactOf(f), theme:f.elements.theme.value.trim(), description:f.elements.description.value.trim(), productTypes:types,
      approxQty:qty, deadline:f.elements.deadline.value.trim(),
      designs:designCount(), designFee:CFG.designFee, designTotal:designCount()*CFG.designFee,
      attachments:customFiles.map(({preview, ...x}) => x), attachmentsNote: customFiles.some(x=>!x.included) ? 'Часть файлов не вложена (крупные) — клиент пришлёт их на почту' : '',
      seller:{company:CFG.companyName, email:CFG.email}};
    addHistory(order);
    f.reset(); customFiles = []; $('#fileList').innerHTML = ''; updateFee();
    showSuccess(order);
    setTimeout(() => { location.href = mailto(order); }, 400);
  });
}

// ---------- invoice (счёт) ----------
function rubWords(sum){
  const ones = [['','один','два','три','четыре','пять','шесть','семь','восемь','девять'],['','одна','две','три','четыре','пять','шесть','семь','восемь','девять']];
  const teens = ['десять','одиннадцать','двенадцать','тринадцать','четырнадцать','пятнадцать','шестнадцать','семнадцать','восемнадцать','девятнадцать'];
  const tens = ['','','двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'];
  const hund = ['','сто','двести','триста','четыреста','пятьсот','шестьсот','семьсот','восемьсот','девятьсот'];
  const forms = (n, f) => { n = n % 100; if (n > 10 && n < 20) return f[2]; n = n % 10; return n === 1 ? f[0] : (n >= 2 && n <= 4 ? f[1] : f[2]); };
  const tri = (n, fem) => { const w = [hund[Math.floor(n/100)]]; const t = n % 100; if (t >= 10 && t < 20) w.push(teens[t-10]); else { w.push(tens[Math.floor(t/10)]); w.push(ones[fem?1:0][t%10]); } return w.filter(Boolean).join(' '); };
  const rub = Math.floor(sum), kop = Math.round((sum - rub) * 100);
  const groups = [[1e9,['миллиард','миллиарда','миллиардов'],0],[1e6,['миллион','миллиона','миллионов'],0],[1e3,['тысяча','тысячи','тысяч'],1]];
  let n = rub, out = [];
  for (const [d, f, fem] of groups){ const g = Math.floor(n / d); if (g){ out.push(tri(g, fem), forms(g, f)); } n %= d; }
  if (n || !out.length) out.push(n ? tri(n, 0) : 'ноль');
  let txt = out.join(' ').replace(/\s+/g,' ').trim();
  txt = txt.charAt(0).toUpperCase() + txt.slice(1);
  return `${txt} ${forms(rub, ['рубль','рубля','рублей'])} ${String(kop).padStart(2,'0')} ${forms(kop, ['копейка','копейки','копеек'])}`;
}
const fmtDate = d => new Date(d).toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit', year:'numeric'});
function invoiceHTML(o){
  const pm = PM[o.payment.id] || o.payment, t = o.totals, e = esc;
  const m2 = n => n.toLocaleString('ru-RU', {minimumFractionDigits:2, maximumFractionDigits:2});
  const isCard = pm.id === 'card';
  const bankTable = `<table class="bank">
    <tr><td colspan="2" rowspan="2" class="w60">${e(pm.bank)}${pm.bankCity ? ', ' + e(pm.bankCity) : ''}<br><small>Банк получателя</small></td><td>БИК</td><td>${e(pm.bik)}</td></tr>
    <tr><td>Сч. №</td><td>${e(pm.corrAccount)}</td></tr>
    <tr><td>ИНН ${e(pm.inn || '—')}</td><td>КПП ${e(pm.kpp || '—')}</td><td rowspan="2">Сч. №</td><td rowspan="2">${e(pm.account)}</td></tr>
    <tr><td colspan="2">${e(pm.fullName || pm.legalName)}<br><small>Получатель</small></td></tr></table>`;
  const cardTable = `<table class="bank kv">
    <tr><td>Получатель</td><td><b>${e(pm.legalName)}</b></td></tr>
    <tr><td>Номер счёта</td><td><b>${e(pm.account)}</b></td></tr>
    <tr><td>Банк получателя</td><td>${e(pm.bank)}</td></tr>
    <tr><td>БИК</td><td>${e(pm.bik)}</td></tr>
    <tr><td>ИНН банка / КПП банка</td><td>${e(pm.bankInn)} / ${e(pm.bankKpp)}</td></tr>
    <tr><td>Корр. счёт</td><td>${e(pm.corrAccount)}</td></tr>
    <tr><td>Назначение платежа</td><td>Оплата по счёту № ${e(o.invoice.number)} от ${fmtDate(o.invoice.date)}. Без НДС</td></tr></table>`;
  const supplier = isCard ? `${e(pm.legalName)} (перевод физическому лицу)` :
    [pm.fullName || pm.legalName, pm.inn && 'ИНН ' + pm.inn, pm.kpp && 'КПП ' + pm.kpp, pm.ogrnip && 'ОГРНИП ' + pm.ogrnip, pm.address, pm.phone && 'тел. ' + pm.phone].filter(Boolean).map(e).join(', ');
  const c = o.contact;
  const buyer = [c.company || c.name, c.inn && 'ИНН ' + c.inn, c.requisites, c.city, c.phone && 'тел. ' + c.phone, c.email].filter(Boolean).map(e).join(', ');
  const rows = o.items.map((i, n) => `<tr><td class="c">${n+1}</td><td>${e(i.name)} — ${e(i.categoryName)}${i.madeToOrderQty ? `<br><small>${i.inStockQty ? num(i.inStockQty) + ' из наличия, ' : ''}${num(i.madeToOrderQty)} под заказ (${e(CFG.madeToOrderLead)})</small>` : ''}</td><td class="r">${num(i.qty)}</td><td class="c">${i.unit === 'комплект' ? 'компл.' : 'шт'}</td><td class="r">${m2(i.unitPrice)}</td><td class="r">${m2(i.sum)}</td></tr>`).join('');
  let totals;
  if (pm.id === 'ooo') totals = `<tr><td>Итого без НДС:</td><td>${m2(t.total)}</td></tr><tr><td>НДС ${Math.round((pm.vatRate||t.markupRate)*100)}%:</td><td>${m2(t.markup)}</td></tr><tr class="b"><td>Всего к оплате (в т.ч. НДС ${Math.round((pm.vatRate||t.markupRate)*100)}%):</td><td>${m2(t.grand)}</td></tr>`;
  else if (pm.id === 'ip') totals = `<tr><td>Итого за товары:</td><td>${m2(t.total)}</td></tr><tr><td>${e(pm.markupLabel || 'Надбавка ' + Math.round(t.markupRate*100) + '%')}:</td><td>${m2(t.markup)}</td></tr><tr><td>НДС:</td><td>Не облагается</td></tr><tr class="b"><td>Всего к оплате:</td><td>${m2(t.grand)}</td></tr>`;
  else totals = `<tr><td>Итого:</td><td>${m2(t.total)}</td></tr><tr><td>Без НДС</td><td>—</td></tr><tr class="b"><td>Всего к оплате:</td><td>${m2(t.grand)}</td></tr>`;
  const discount = t.discountPercent ? `<p class="small">Применена скидка от тиража ${t.discountPercent}% (−${m2(t.discount)} ₽), цены в таблице указаны со скидкой.</p>` : '';
  const resLines = (o.reservation && o.reservation.lines) || [];
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Счёт № ${e(o.invoice.number)}</title><style>
  body{font:13px/1.4 Arial,Helvetica,sans-serif;color:#000;background:#fff;max-width:800px;margin:20px auto;padding:0 16px}
  table{border-collapse:collapse;width:100%} td,th{border:1px solid #000;padding:4px 6px;vertical-align:top}
  .bank td{font-size:12px}.bank small{color:#444}.w60{width:60%}.kv td:first-child{width:35%;color:#333}
  h1{font-size:20px;border-bottom:2px solid #000;padding-bottom:6px;margin:22px 0 10px}
  .parties td{border:0;padding:3px 0}.parties td:first-child{width:110px;color:#333}
  .items th{background:#eee}.r{text-align:right;white-space:nowrap}.c{text-align:center}
  .tot{width:auto;margin-left:auto;margin-top:6px}.tot td{border:0;text-align:right;padding:2px 6px}.tot .b td{font-weight:bold;font-size:14px}
  .small{font-size:12px;color:#333}.box{border:2px solid #000;padding:8px 10px;margin:14px 0;font-weight:bold}.box.dlv{border-style:dashed;font-weight:normal}
  .sign{margin-top:30px;display:flex;gap:40px}.sign div{flex:1;border-bottom:1px solid #000;padding-bottom:18px}
  .tools{margin:0 0 14px;display:flex;gap:8px}.tools button{padding:8px 14px;font-size:14px;cursor:pointer}
  @media print{.tools{display:none} body{margin:0}}
  </style></head><body>
  <div class="tools"><button onclick="window.print()">🖨 Печать / Сохранить в PDF</button></div>
  ${isCard ? '<h3 style="margin:0 0 6px">Реквизиты для перевода</h3>' + cardTable : bankTable}
  <h1>Счёт на оплату № ${e(o.invoice.number)} от ${fmtDate(o.invoice.date)}</h1>
  <table class="parties"><tr><td>Поставщик:</td><td><b>${supplier}</b></td></tr>
  <tr><td>Покупатель:</td><td><b>${buyer}</b></td></tr>
  <tr><td>Основание:</td><td>Заказ № ${e(o.id)} (${e(o.modeName || '')}), способ оплаты: ${e(pm.label)}</td></tr>
  ${o.delivery ? `<tr><td>Доставка:</td><td>${e(deliveryText(o.delivery))}</td></tr>` : ''}</table>
  <table class="items" style="margin-top:10px"><thead><tr><th>№</th><th>Товар</th><th>Кол-во</th><th>Ед.</th><th>Цена, ₽</th><th>Сумма, ₽</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="tot">${totals}</table>
  ${discount}
  <p>Всего наименований ${o.items.length}, на сумму ${m2(t.grand)} руб.<br><b>${rubWords(t.grand)}</b>${pm.id === 'ooo' ? `, в т.ч. НДС ${Math.round((pm.vatRate||0.22)*100)}%` : (pm.id === 'ip' ? ', НДС не облагается' : '')}</p>
  <div class="box">Счёт действителен до ${fmtDate(o.invoice.payUntil)} включительно.${resLines.length ? ` Товар из наличия (${num(resLines.reduce((a,l)=>a+l.qty,0))} шт) забронирован до ${fmtDate(o.reservation.expiresAt)}; если оплата не поступит, бронь снимается.` : ''}</div>
  ${o.delivery ? `<div class="box dlv">🚚 ${e(DLV_NOTICE)}${o.delivery.kind === 'pickup' ? ' Выбран самовывоз из г. Павловск — время согласуем.' : ''}</div>` : ''}
  <p class="small">В назначении платежа укажите: «Оплата по счёту № ${e(o.invoice.number)}». Позиции «под заказ» изготавливаются ${e(CFG.madeToOrderLead)} после оплаты.</p>
  <p class="small">Контакты: тел./Telegram/WhatsApp ${e(CFG.phone || '')}${CFG.email ? ', email ' + e(CFG.email) : ''}</p>
  ${isCard ? '' : `<div class="sign"><div>${pm.id === 'ip' ? 'Индивидуальный предприниматель' : 'Руководитель'}</div><div>${pm.id === 'ip' ? 'Таран Н. С.' : 'Бухгалтер'}</div></div>`}
  </body></html>`;
}
function openInvoice(o){
  const html = invoiceHTML(o);
  let w = null;
  try { w = window.open('', '_blank'); if (w) { w.document.open(); w.document.write(html); w.document.close(); } } catch(e){ w = null; }
  return w;
}
const fmtDT = d => new Date(d).toLocaleString('ru-RU', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'}).replace(',', '');
function sheetRowsCSV(o){
  const head = ['orderId','dateIssued','expiresAt','productId','productName','category','qty','status','paymentMethod','customer','Строка склада','Списано'];
  const rows = (o.reservation?.lines || []).map(l => [o.id, fmtDT(o.createdAt), fmtDT(o.reservation.expiresAt), l.productId, l.productName, l.category, l.qty, 'бронь', o.payment.label, o.contact.company || o.contact.name, (l.stockRows || []).join(' | '), '']);
  return '\ufeff' + [head].concat(rows).map(r => r.map(csvCell).join(';')).join('\r\n');
}

// ---------- export / success ----------
function download(name, content, mime){
  const blob = new Blob([content], {type:mime}); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const csvCell = v => { v = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? ''); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v; };
function toCSV(o){
  const rows = [];
  const kv = (k,v) => rows.push([k, v]);
  kv(o.type === 'custom' ? 'Заявка' : 'Заказ', o.id); kv('Тип', o.typeName); kv('Дата', new Date(o.createdAt).toLocaleString('ru-RU'));
  kv('Имя', o.contact.name); kv('Телефон', o.contact.phone); kv('Email', o.contact.email); kv('Компания', o.contact.company);
  if (o.type === 'catalog'){
    kv('Город', o.contact.city); kv('Комментарий', o.comment);
    if (o.delivery){ const d = o.delivery; kv('Доставка', d.service); kv('Город доставки', d.city); kv('Адрес / ПВЗ', d.address); kv('Индекс', d.postIndex); kv('Получатель', d.recipientName); kv('Телефон получателя', d.recipientPhone); kv('Комментарий к доставке', d.comment); kv('Оплата доставки', d.payer); kv('Трек-номер', ''); }
    if (o.consents) kv('Согласия', consentText(o.consents));
    if (o.payment){ kv('Режим', o.modeName); kv('Способ оплаты', o.payment.label); kv('Получатель', o.payment.legalName); kv('Счёт №', o.invoice.number); kv('Бронь до', new Date(o.reservation.expiresAt).toLocaleString('ru-RU')); if (o.contact.inn) kv('ИНН покупателя', o.contact.inn); }
    rows.push([]);
    rows.push(['Артикул','Наименование','Тип','Ед.','Кол-во','Наличие','Из наличия','Под заказ','Цена базовая, ₽','Цена со скидкой, ₽','Сумма, ₽']);
    o.items.forEach(i => rows.push([i.id, i.name, i.categoryName, i.unit, i.qty, i.availability||'', i.inStockQty??'', i.madeToOrderQty??'', i.basePrice, i.unitPrice, i.sum]));
    rows.push([]); kv('Всего изделий', o.totals.totalQty); kv('Сумма без скидки, ₽', o.totals.subtotal); kv('Скидка, %', o.totals.discountPercent); kv('Скидка, ₽', o.totals.discount); kv('Итого, ₽', o.totals.total);
    if (o.payment){ kv((o.payment.markupLabel || 'Надбавка') + ', ₽', o.totals.markup); kv('К оплате, ₽', o.totals.grand); }
  } else {
    kv('Тематика', o.theme); kv('Описание', o.description); kv('Изделия', o.productTypes.join(', ')); kv('Тираж, шт', o.approxQty ?? ''); kv('Срок', o.deadline); kv('Кол-во дизайнов', o.designs); kv('Стоимость разработки 1 дизайна, ₽', o.designFee); kv('Итого за разработку, ₽', o.designTotal);
    kv('Файлы', (o.attachments||[]).map(a => a.name + (a.included ? ' (вложен в JSON)' : ' (не вложен — пришлёт на почту)')).join('; '));
  }
  return '\ufeff' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
}
function mailBody(o){
  const L = [`${o.type === 'custom' ? 'Заявка' : 'Заказ'} ${o.id} — ${o.typeName}`, `Дата: ${new Date(o.createdAt).toLocaleString('ru-RU')}`, '',
    `Имя: ${o.contact.name}`, `Телефон: ${o.contact.phone}`, `Email: ${o.contact.email}`, o.contact.company ? `Компания: ${o.contact.company}` : '', ''];
  if (o.type === 'catalog'){
    if (o.contact.city) L.push(`Город: ${o.contact.city}`);
    if (o.comment) L.push(`Комментарий: ${o.comment}`);
    if (o.delivery) L.push(`Доставка: ${deliveryText(o.delivery)}`, DLV_NOTICE);
    L.push('Состав:');
    let added = 0;
    for (const i of o.items){ const s = `- ${i.name} (${i.categoryName}) — ${i.qty} × ${i.unitPrice} ₽ = ${i.sum} ₽ [${i.availability||''}]`; if ((L.join('\n')+s).length > 1400){ L.push(`…и ещё ${o.items.length - added} поз. (полный список — в приложенном файле)`); break; } L.push(s); added++; }
    const sIn = o.items.reduce((a,i)=>a+(i.inStockQty||0),0), sOrd = o.items.reduce((a,i)=>a+(i.madeToOrderQty||0),0);
    L.push('', `Из наличия: ${sIn} шт; под заказ: ${sOrd} шт` + (sOrd ? ` (изготовление ${CFG.madeToOrderLead})` : ''));
    L.push(`Всего: ${o.totals.totalQty} шт`, o.mode === 'retail' ? 'Розничные цены' : `Скидка: ${o.totals.discountPercent}% (−${o.totals.discount} ₽)`, `Итого за товары: ${o.totals.total} ₽`);
    if (o.payment){
      if (o.totals.markup) L.push(`${o.payment.markupLabel}: +${o.totals.markup} ₽`);
      L.push(`К оплате: ${o.totals.grand} ₽`, '', `Режим: ${o.modeName}`, `Способ оплаты: ${o.payment.label} (${o.payment.legalName})`, `Счёт № ${o.invoice.number} от ${fmtDate(o.invoice.date)}`,
        o.contact.inn ? `ИНН покупателя: ${o.contact.inn}` : '', o.contact.requisites ? `Реквизиты покупателя: ${o.contact.requisites}` : '',
        `Бронь из наличия: ${o.reservation.lines.length ? o.reservation.lines.map(l => l.productName + ' — ' + l.qty).join(', ') : 'нет'} — до ${fmtDate(o.reservation.expiresAt)}`);
    }
  } else {
    L.push(`Тематика: ${o.theme}`, `Описание: ${o.description}`, `Изделия: ${o.productTypes.join(', ')}`, `Тираж: ${o.approxQty ?? 'не указан'}`, o.deadline ? `Срок: ${o.deadline}` : '', '', `Разработка дизайна: ${o.designs} × ${o.designFee} ₽ = ${o.designTotal} ₽`);
    L.push((o.attachments||[]).length ? `Мои варианты дизайна (${o.attachments.length}): ${o.attachments.map(a=>a.name).join(', ')} — прикладываю к письму` : 'Мои варианты дизайна: приложу к письму / пришлю отдельно');
  }
  return L.filter((x,i,a) => x !== '' || a[i-1] !== '').join('\n');
}
function mailto(o){
  return `mailto:${encodeURIComponent(CFG.email||'')}?subject=${encodeURIComponent(`${o.type === 'custom' ? 'Заявка' : 'Заказ'} ${o.id}: ${o.typeName}` + (o.invoice ? ` · счёт № ${o.invoice.number} · ${o.payment.label}` : ''))}&body=${encodeURIComponent(mailBody(o))}`;
}
function orderDetailsHTML(o){
  if (o.type === 'catalog') return summaryTable(o.items) + `<div class="totals"><span>Всего изделий</span><span>${num(o.totals.totalQty)} шт</span><span>Без скидки</span><span>${money(o.totals.subtotal)}</span>${o.totals.discountPercent ? `<span class="disc">Скидка ${o.totals.discountPercent}%</span><span class="disc">−${money(o.totals.discount)}</span>` : ''}${o.totals.markup ? `<span>Товары</span><span>${money(o.totals.total)}</span><span class="markup">${esc(o.payment.markupLabel)}</span><span class="markup">+${money(o.totals.markup)}</span>` : ''}<span class="grand">К оплате</span><span class="grand">${money(o.totals.grand ?? o.totals.total)}</span></div>` +
    (o.payment ? `<div class="by-cat">${esc(o.modeName||'')} · оплата: <b>${esc(o.payment.label)}</b> (${esc(o.payment.legalName)}) · счёт № ${esc(o.invoice.number)}${o.reservation.lines.length ? ` · бронь ${num(o.reservation.lines.reduce((a,l)=>a+l.qty,0))} шт до ${ddmm(o.reservation.expiresAt)}` : ''}</div>` : '') +
    (o.delivery ? `<div class="hint-box dlv-box">🚚 ${esc(deliveryText(o.delivery))}<br>${esc(DLV_NOTICE)}</div>` : '');
  return `<table class="sum-table"><tbody>
    <tr><td>Тематика</td><td>${esc(o.theme)}</td></tr><tr><td>Описание</td><td>${esc(o.description)}</td></tr>
    <tr><td>Изделия</td><td>${esc(o.productTypes.join(', '))}</td></tr><tr><td>Разработка дизайна</td><td>${o.designs} × ${money(o.designFee)} = <b>${money(o.designTotal)}</b></td></tr><tr><td>Тираж</td><td>${o.approxQty ? num(o.approxQty)+' шт' : '—'}</td></tr>
    ${o.deadline?`<tr><td>Срок</td><td>${esc(o.deadline)}</td></tr>`:''}
    <tr><td>Файлы</td><td>${(o.attachments||[]).length ? o.attachments.map(a => esc(a.name) + (a.included?' ✓':' — пришлите на почту')).join('<br>') : '—'}</td></tr>
  </tbody></table>`;
}
let lastOrder = null;
// Служебные кнопки (JSON / CSV / строки «Бронь») — только без Apps Script или по ссылке ?admin=1
const IS_ADMIN = /[?&]admin=1(&|$)/.test(location.search);
const showInternalTools = () => IS_ADMIN || !CFG.appsScriptUrl;
function showSuccess(o, popupBlocked){
  lastOrder = o;
  const inv = o.invoice ? `<div class="invoice-box"><div><b>🧾 Счёт № ${esc(o.invoice.number)}</b> · ${esc(o.payment.label)} · к оплате <b>${money(o.totals.grand)}</b></div>
    <div class="muted">Счёт ${popupBlocked ? 'готов — откройте его кнопкой ниже' : 'открыт в новой вкладке'}. Оплатите до <b>${fmtDate(o.invoice.payUntil)}</b> включительно${o.reservation.lines.length ? ` — до этого времени товар из наличия (${num(o.reservation.lines.reduce((a,l)=>a+l.qty,0))} шт) забронирован за вами` : ''}. После этого бронь снимается.</div>
    <div class="actions"><button class="btn primary" data-inv="open">🧾 Открыть счёт / печать</button><button class="btn" data-inv="dl">⬇ Скачать счёт (HTML)</button></div></div>` : '';
  const internal = showInternalTools();
  const isCat = o.type !== 'custom';
  $('#successBox').innerHTML = `<div class="big-ok">✅</div><h1>${isCat ? 'Заказ принят' : 'Заявка на дизайн принята'}</h1>
    <p class="lead" style="margin:0 auto">${isCat ? 'Номер заказа' : 'Номер заявки'} <b>${esc(o.id)}</b>. ${esc(o.contact.name)}, мы свяжемся с вами по телефону ${esc(o.contact.phone)} или почте ${esc(o.contact.email)}.</p>
    <p class="muted success-contacts-label">Написать нам сейчас:</p>
    ${contactButtonsHTML('success')}
    <p class="muted">${o.type==='custom' ? `Сейчас откроется письмо на ${esc(CFG.email||'нашу почту')} — <b>приложите к нему свои варианты дизайна</b> и отправьте. Если письмо не открылось, нажмите «Отправить письмом».` : (internal ? `Скачайте файл заказа и отправьте его нам на почту${CFG.email ? ' ' + esc(CFG.email) : ''} — или нажмите «Отправить письмом».` : `Счёт продублируем на почту ${esc(o.contact.email)}. После оплаты отправим заказ и пришлём трек-номер. Вопросы — пишите в Telegram или WhatsApp.`)}</p>
    ${inv}
    <div class="actions">
      ${internal ? `<button class="btn primary" data-dl="json">⬇ Скачать JSON</button>
      <button class="btn primary" data-dl="csv">⬇ Скачать CSV (Excel)</button>` : ''}
      <a class="btn" href="${esc(mailto(o))}">✉ Отправить письмом</a>
      ${internal && o.reservation && o.reservation.lines.length ? '<button class="btn ghost" data-dl="sheet">⬇ Строки для вкладки «Бронь»</button>' : ''}
    </div>
    ${orderDetailsHTML(o)}
    <div class="actions"><a class="btn ghost" href="#catalog">В каталог</a><a class="btn ghost" href="#history">Мои заказы</a></div>`;
  location.hash = '#success';
  window.scrollTo(0,0);
}
function dlOrder(o, kind){
  if (kind === 'json') download(`zayavka-${o.id}.json`, JSON.stringify(o, null, 2), 'application/json');
  else if (kind === 'sheet') download(`bron-${o.id}.csv`, sheetRowsCSV(o), 'text/csv;charset=utf-8');
  else download(`zayavka-${o.id}.csv`, toCSV(o), 'text/csv;charset=utf-8');
}
document.addEventListener('click', e => {
  const iv = e.target.closest('[data-inv]');
  if (iv) { const o = iv.dataset.oid ? load(LS_HIST, []).find(x => x.id === iv.dataset.oid) : lastOrder; if (!o || !o.invoice) return;
    if (iv.dataset.inv === 'open') { if (!openInvoice(o)) download(`schet-${o.invoice.number}.html`, invoiceHTML(o), 'text/html;charset=utf-8'); }
    else download(`schet-${o.invoice.number}.html`, invoiceHTML(o), 'text/html;charset=utf-8'); return; }
  const b = e.target.closest('[data-dl]'); if (!b) return;
  const o = b.dataset.oid ? load(LS_HIST, []).find(x => x.id === b.dataset.oid) : lastOrder;
  if (o) dlOrder(o, b.dataset.dl);
});

// ---------- history ----------
function addHistory(o){
  const h = load(LS_HIST, []);
  const light = {...o, attachments:(o.attachments||[]).map(({dataUrl, ...rest}) => ({...rest, ...(dataUrl ? {note:'Файл был вложен в скачанный JSON'} : {})}))};
  h.unshift(light);
  if (!save(LS_HIST, h.slice(0, 50))) toast('Не удалось сохранить в историю (переполнено хранилище)');
}
function renderHistory(){
  const h = load(LS_HIST, []);
  $('#historyList').innerHTML = h.length ? h.map(o => `<details class="card hist"><summary class="hist-head"><b>${esc(o.id)}</b><span>${esc(o.typeName)}</span><span class="muted">${new Date(o.createdAt).toLocaleString('ru-RU')}</span><span>${o.type==='catalog' ? num(o.totals.totalQty)+' шт · '+money(o.totals.grand ?? o.totals.total) + (o.payment ? ' · ' + esc(o.payment.label) : '') : esc(o.theme)}</span></summary>
    <div style="margin-top:12px">${orderDetailsHTML(o)}<div class="actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${showInternalTools() ? `<button class="btn" data-dl="json" data-oid="${esc(o.id)}">⬇ JSON</button><button class="btn" data-dl="csv" data-oid="${esc(o.id)}">⬇ CSV</button>` : ''}<a class="btn" href="${esc(mailto(o))}">✉ Письмом</a>${o.invoice ? `<button class="btn" data-inv="open" data-oid="${esc(o.id)}">🧾 Счёт</button>` : ''}</div></div></details>`).join('')
    : '<p class="empty">Пока нет заявок. <a href="#catalog">Перейти в каталог</a></p>';
}

// ---------- routing ----------
function parseHash(){
  let raw = (location.hash || '#home').slice(1);
  try { raw = decodeURIComponent(raw); } catch(e){}
  let view = 'home', band = '';
  if (!raw) return {view, band};
  if (/^band=/i.test(raw)){
    view = 'catalog';
    band = raw.slice(5).split('&')[0].split('?')[0];
    return {view, band};
  }
  const parts = raw.split(/[?&]/);
  view = parts[0] || 'home';
  for (const part of parts.slice(1)){
    const i = part.indexOf('=');
    const k = i < 0 ? part : part.slice(0, i);
    const val = i < 0 ? '' : part.slice(i + 1);
    if (k === 'band') band = val;
  }
  return {view, band};
}
function route(){
  const parsed = parseHash();
  let v = parsed.view;
  if (!$('#view-' + v)) v = 'home';
  if (v === 'success' && !lastOrder) v = 'home';
  const arriving = $('#view-' + v) && $('#view-' + v).hidden;
  $$('.view').forEach(s => s.hidden = s.id !== 'view-' + v);
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === v || (v === 'catalog' && a.dataset.nav === 'catalog')));
  if (v === 'catalog'){
    if (arriving) activeCat = 'all';
    activeBand = resolveBandSlug(parsed.band);
    renderBandIndex(); renderTabs(); renderGrid();
  }
  if (v === 'checkout') renderCheckoutSummary();
  if (v === 'history') renderHistory();
  closeDrawer();
  if (arriving || v !== 'catalog') window.scrollTo(0, 0);
}
let toastT;
function toast(m){ const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); }

// ---------- mode gate: Опт / Розница ----------
function applyMode(){
  document.body.classList.toggle('mode-retail', mode === 'retail');
  document.body.classList.toggle('mode-wholesale', mode !== 'retail');
  $('#modeGate').hidden = !!mode;
  $('#modeLabel').textContent = mode ? MODE_NAME[mode] : '—';
  $('#retailPriceTxt').textContent = money(CFG.retailPrices.default);
  $('#retailEarTxt').textContent = money(CFG.retailPrices.earrings);
  $('#unitPriceHead').textContent = isRetail() ? 'Розничные цены' : 'Цены (тираж 500–999 шт)';
  initStatic(); renderBandIndex(); renderTabs(); renderGrid(); refreshCart();
  if (location.hash === '#checkout') renderCheckoutSummary();
}
function setMode(m){ mode = m; try { localStorage.setItem(LS_MODE, m); } catch(e){} applyMode(); toast(m === 'retail' ? 'Розница: все изделия по ' + money(CFG.retailPrices.default) : 'Опт: цены от тиража, минимум ' + num(CFG.minOrderQty) + ' шт'); }
function bindMode(){
  $$('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#modeBtn').addEventListener('click', () => { $('#modeGate').hidden = false; });
}
// ---------- remote reservations (опубликованный CSV / Apps Script) ----------
function parseCSV(t){
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++){ const ch = t[i];
    if (q){ if (ch === '"' && t[i+1] === '"'){ cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cur); cur = ''; } else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (ch !== '\r') cur += ch; }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [h, ...body] = rows; return body.filter(r => r.some(Boolean)).map(r => Object.fromEntries(h.map((k, i) => [k.trim(), r[i]])));
}
async function loadRemoteReservations(){
  if (!/^https?:/.test(location.protocol)) return;
  try {
    if (CFG.appsScriptUrl) { const r = await fetch(CFG.appsScriptUrl + '?action=reservations'); const j = await r.json(); resRemote = j.reservations || []; }
    else if (CFG.reservationsCsvUrl) { const r = await fetch(CFG.reservationsCsvUrl); resRemote = parseCSV(await r.text()).map(x => ({...x, qty: Number(x.qty)})); }
    else return;
    resetRes(); renderGrid(); refreshCart();
  } catch(e){ console.warn('Брони из таблицы не загрузились', e); }
}

bindMode(); applyMode(); renderTabs(); renderBandIndex(); bindGrid(); bindBandIndex(); bindFittings(); bindCart(); bindOrderForm(); bindCustomForm();
window.addEventListener('hashchange', route); route();
loadRemoteReservations();
let lastActive = JSON.stringify(resIndex());
setInterval(() => { resetRes(); const a = JSON.stringify(resIndex()); if (a !== lastActive) { lastActive = a; renderGrid(); refreshCart(); } }, 60000); // истёкшие брони освобождаются без перезагрузки
window.__merch = {calc: (pm) => calc(cart, pm), setQty, available, reservedOf, setMode, invoiceHTML, rubWords, BANDS, setBand, resolveBandSlug, parseHash};
})();
