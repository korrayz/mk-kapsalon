'use strict';

// ---------- API ----------
let TOKEN = sessionStorage.getItem('mk_token') || '';
let META = null;

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + TOKEN,
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { showLogin(); throw new Error('unauthorized'); }
  if (!res.ok) { const e = new Error(data.error || 'Hata'); e.data = data; e.status = res.status; throw e; }
  return data;
}

const $ = (s) => document.querySelector(s);
const DAYS_TR = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const STATUS_TR = { scheduled: 'Bekliyor', completed: 'Tamamlandı', no_show: 'Gelmedi', cancelled: 'İptal' };
const eur = (c) => '€ ' + (c / 100).toFixed(2).replace('.', ',').replace(',00', '');
const fmtDate = (d) => {
  const dt = new Date(d + 'T00:00:00');
  return dt.getDate() + '.' + (dt.getMonth() + 1) + '.' + dt.getFullYear() + ' ' + DAYS_TR[dt.getDay()];
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

// Native confirm/prompt yerine panel içi diyalog
function uiDialog(msg, withInput) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'modal';
    ov.style.zIndex = 90;
    ov.innerHTML = `
      <div class="modal-card" style="max-width:380px">
        <p style="white-space:pre-line;margin-bottom:16px">${esc(msg)}</p>
        ${withInput ? '<input type="text" class="dlg-input" style="width:100%;margin-bottom:14px" />' : ''}
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-ghost dlg-no">Vazgeç</button>
          <button class="btn btn-gold dlg-yes">Onayla</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const input = ov.querySelector('.dlg-input');
    if (input) input.focus();
    const done = (val) => { ov.remove(); resolve(val); };
    ov.querySelector('.dlg-no').addEventListener('click', () => done(withInput ? null : false));
    ov.querySelector('.dlg-yes').addEventListener('click', () => done(withInput ? input.value : true));
    ov.addEventListener('click', (e) => { if (e.target === ov) done(withInput ? null : false); });
  });
}
const uiConfirm = (msg) => uiDialog(msg, false);
const uiPrompt = (msg) => uiDialog(msg, true);

// Kaydet butonlarında satır içi geri bildirim: "Kaydediliyor…" → "✓ Kaydedildi"; hata butonun hemen altına yazılır.
const CHECK_SVG = '<svg class="ico-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
async function saveWith(btn, fn, okText = 'Kaydedildi') {
  if (btn.disabled) return false;
  const label = btn.innerHTML;
  const host = btn.parentElement.classList.contains('form-row') ? btn.parentElement : btn;
  if (host.nextElementSibling?.classList.contains('field-error')) host.nextElementSibling.remove();
  btn.disabled = true;
  btn.style.minWidth = btn.offsetWidth + 'px';
  btn.textContent = 'Kaydediliyor…';
  const restore = () => { btn.classList.remove('is-ok'); btn.innerHTML = label; btn.disabled = false; btn.style.minWidth = ''; };
  try {
    await fn();
  } catch (e) {
    restore();
    if (!e.silent) host.insertAdjacentHTML('afterend', `<p class="field-error">${esc(e.message)}</p>`);
    return false;
  }
  btn.classList.add('is-ok');
  btn.innerHTML = CHECK_SVG + okText;
  setTimeout(() => { if (btn.isConnected) restore(); }, 1800);
  return true;
}
const cancelled = () => Object.assign(new Error(''), { silent: true });
// Modal içindeki kayıtlarda: onay işareti kısa süre görünsün, sonra kapansın
const closeAfterSave = (then) => setTimeout(() => { closeModal(); then?.(); }, 650);

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', !!isErr);
  t.hidden = false;
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.hidden = true), 3200);
}

// ---------- Auth ----------
function showLogin() {
  $('#loginScreen').style.display = 'flex';
  $('#app').hidden = true;
}
async function boot() {
  try {
    META = await api('/meta');
  } catch { return; }
  $('#loginScreen').style.display = 'none';
  $('#app').hidden = false;
  fillSelects();
  $('#agendaDate').value = META.today;
  loadAgenda();
  loadStats();
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  try {
    const r = await api('/login', { method: 'POST', body: { password: $('#loginPass').value } });
    TOKEN = r.token;
    sessionStorage.setItem('mk_token', TOKEN);
    boot();
  } catch (err) {
    $('#loginErr').textContent = err.message;
  }
});
$('#logoutBtn').addEventListener('click', () => {
  TOKEN = '';
  sessionStorage.removeItem('mk_token');
  showLogin();
});

function fillSelects() {
  const bOpts = META.barbers.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  const prevSvc = $('#slotService').value;
  $('#agendaBarber').innerHTML = '<option value="">Tüm berberler</option>' + bOpts;
  $('#slotService').innerHTML = META.services
    .map((s) => `<option value="${s.id}" data-dur="${s.duration_min}">${esc(s.name)} — ${s.duration_min} dk</option>`)
    .join('');
  if (prevSvc && META.services.some((s) => s.id == prevSvc)) $('#slotService').value = prevSvc;
}

async function loadStats() {
  try {
    const s = await api('/stats');
    $('#sideStats').innerHTML =
      `<span>Bugün: <b>${s.today_left}</b> bekleyen / ${s.today_total} randevu</span>` +
      `<span>Açık ceza: <b>${eur(s.open_penalties)}</b></span>` +
      `<span>Kara liste: <b>${s.blacklist_count}</b> kişi</span>`;
  } catch {}
}

// ---------- Tabs ----------
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
    ({ agenda: loadAgenda, slots: loadSlots, customers: loadCustomers, penalties: loadPenalties, blacklist: loadBlacklist, settings: loadSettings }[btn.dataset.tab] || (() => {}))();
  });
});

// ---------- Agenda ----------
// range: null = tek gün görünümü; aksi halde { key, label, from, to }
const AG = { range: null, req: 0 };
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const addDaysStr = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
function shortSpan(from, to) {
  const a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00');
  const mon = (d) => MONTHS_TR[d.getMonth()].slice(0, 3);
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()} – ${b.getDate()} ${mon(b)}`
    : `${a.getDate()} ${mon(a)} – ${b.getDate()} ${mon(b)}`;
}

function updateAgendaChrome() {
  const date = $('#agendaDate').value;
  const diff = Math.round((new Date(date + 'T00:00:00') - new Date(META.today + 'T00:00:00')) / 86400000);
  $('#periodVal').textContent = AG.range ? AG.range.label
    : diff === 0 ? 'Bugün' : diff === 1 ? 'Yarın' : diff === -1 ? 'Dün' : 'Tek gün';
  $('#dayNav').hidden = !!AG.range;
  $('#rangeChip').hidden = !AG.range;
  if (AG.range) $('#rangeText').textContent = shortSpan(AG.range.from, AG.range.to);
}

async function loadAgenda() {
  const req = ++AG.req;
  updateAgendaChrome();
  const params = new URLSearchParams();
  if (AG.range) { params.set('from', AG.range.from); params.set('to', AG.range.to); }
  else params.set('date', $('#agendaDate').value);
  if ($('#agendaBarber').value) params.set('barber_id', $('#agendaBarber').value);
  if ($('#agendaStatus').value) params.set('status', $('#agendaStatus').value);
  const rows = await api('/appointments?' + params);
  if (req !== AG.req) return;
  const list = $('#agendaList');

  if (AG.range) {
    list.innerHTML = renderRangeSummary(rows) + (rows.length ? renderDayGroups(rows) : '<div class="empty">Bu dönemde randevu yok</div>');
  } else {
    list.innerHTML = rows.length ? rows.map(apptCard).join('') : `<div class="empty">${fmtDate($('#agendaDate').value)} — randevu yok</div>`;
  }
  bindApptActions(list);
}

function renderRangeSummary(rows) {
  const count = (s) => rows.filter((a) => a.status === s).length;
  const sum = (s) => rows.filter((a) => a.status === s).reduce((t, a) => t + (a.price_cents || 0), 0);
  const parts = [`<span><b>${rows.length}</b> randevu</span>`];
  if (count('scheduled')) parts.push(`<span><b>${count('scheduled')}</b> bekleyen</span>`);
  if (count('completed')) parts.push(`<span><b>${count('completed')}</b> tamamlandı</span>`);
  if (count('no_show')) parts.push(`<span class="red"><b>${count('no_show')}</b> gelmedi</span>`);
  if (count('cancelled')) parts.push(`<span><b>${count('cancelled')}</b> iptal</span>`);
  if (sum('completed')) parts.push(`<span class="gold">Ciro <b>${eur(sum('completed'))}</b></span>`);
  if (sum('scheduled')) parts.push(`<span class="gold">Beklenen <b>${eur(sum('scheduled'))}</b></span>`);
  return `<div class="range-sum">${parts.join('')}</div>`;
}

function renderDayGroups(rows) {
  const byDay = {};
  for (const a of rows) (byDay[a.date] ||= []).push(a);
  return Object.keys(byDay).sort().map((date) => `
    <div class="day-group">
      <h4 class="day-head">${date === META.today ? '<span class="today-tag">Bugün</span> · ' : ''}${longDate(date)}
        <span class="day-count">· ${byDay[date].length} randevu</span></h4>
      <div class="appt-list">${byDay[date].map(apptCard).join('')}</div>
    </div>`).join('');
}

function apptCard(a) {
  const endMin = toMin(a.start_time) + a.duration_min;
  return `
    <div class="appt-card ${a.status}">
      <div class="appt-time">${a.start_time}<small>– ${toHHMM(endMin)}</small></div>
      <div class="appt-info">
        <div class="name">${esc(a.customer_name)} ${a.blacklisted ? '<span class="badge bl">KARA LİSTE</span>' : ''}</div>
        <div class="sub">${esc(a.barber_name)} · ${esc(a.service_name || 'Hizmet seçilmedi')}${a.price_cents ? ' · ' + eur(a.price_cents) : ''}${a.customer_phone ? ' · ' + esc(a.customer_phone) : ''}${a.note ? ' · Not: ' + esc(a.note) : ''}</div>
      </div>
      <span class="badge ${a.status}">${STATUS_TR[a.status]}</span>
      <div class="appt-actions">
        ${a.status === 'scheduled' ? `
          <button class="btn small" data-act="completed" data-id="${a.id}">Geldi</button>
          <button class="btn small danger" data-act="no_show" data-id="${a.id}">Gelmedi</button>
          <button class="btn small btn-ghost" data-act="cancelled" data-id="${a.id}">İptal</button>` : `
          <button class="btn small btn-ghost" data-act="scheduled" data-id="${a.id}">Geri al</button>`}
        <button class="btn small btn-ghost danger" data-act="delete" data-id="${a.id}">Sil</button>
      </div>
    </div>`;
}

function bindApptActions(list) {
  list.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id, act = btn.dataset.act;
      try {
        if (act === 'delete') {
          if (!(await uiConfirm('Randevu silinsin mi?'))) return;
          await api('/appointments/' + id, { method: 'DELETE' });
        } else {
          if (act === 'no_show' && !(await uiConfirm(`Müşteri gelmedi olarak işaretlenecek ve ${eur(META.no_show_fee_cents)} ceza yazılacak. Onaylıyor musun?`))) return;
          await api('/appointments/' + id, { method: 'PATCH', body: { status: act } });
          if (act === 'no_show') toast(`Ceza eklendi: ${eur(META.no_show_fee_cents)}`);
        }
        loadAgenda(); loadStats();
      } catch (e) { toast(e.message, true); }
    });
  });
}
function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function toHHMM(min) { return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }

$('#agendaDate').addEventListener('change', () => { AG.range = null; loadAgenda(); });
$('#agendaBarber').addEventListener('change', loadAgenda);
$('#agendaStatus').addEventListener('change', loadAgenda);
$('#prevDay').addEventListener('click', () => shiftDay(-1));
$('#nextDay').addEventListener('click', () => shiftDay(1));
function shiftDay(n) {
  AG.range = null;
  $('#agendaDate').value = addDaysStr($('#agendaDate').value, n);
  loadAgenda();
}
function showDay(date) {
  AG.range = null;
  $('#agendaDate').value = date;
  loadAgenda();
}
$('#rangeClear').addEventListener('click', () => showDay(META.today));

// ---------- Dönem seçici ----------
const PERIODS = {
  past: [7, 15, 30, 45],
  future: [7, 15, 30, 45],
};
function renderPeriodPop() {
  const t = META.today;
  const activeKey = AG.range ? AG.range.key : ($('#agendaDate').value === t ? 'today' : null);
  const item = (dir, n, i) => {
    const key = dir + n;
    const from = dir === 'p' ? addDaysStr(t, -(n - 1)) : t;
    const to = dir === 'p' ? t : addDaysStr(t, n - 1);
    const label = (dir === 'p' ? 'Son ' : 'Önümüzdeki ') + n + ' gün';
    return `
      <button type="button" class="pp-item ${activeKey === key ? 'on' : ''}" style="--i:${i}"
        data-key="${key}" data-from="${from}" data-to="${to}" data-label="${label}">
        <span class="pp-name">${n} gün</span>
        <span class="pp-span">${shortSpan(from, to)}</span>
      </button>`;
  };
  $('#periodPop').innerHTML = `
    <div class="pp-title">Dönem seç</div>
    <button type="button" class="pp-today ${activeKey === 'today' ? 'on' : ''}" data-key="today">
      <span class="pp-name">Bugün</span>
      <span class="pp-span">${longDate(t)}</span>
    </button>
    <div class="pp-cols">
      <div class="pp-col past">
        <div class="pp-head">← Geçmiş</div>
        ${PERIODS.past.map((n, i) => item('p', n, i)).join('')}
      </div>
      <div class="pp-col future">
        <div class="pp-head">Gelecek →</div>
        ${PERIODS.future.map((n, i) => item('f', n, i)).join('')}
      </div>
    </div>`;
  $('#periodPop').querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => {
    closePeriod();
    if (b.dataset.key === 'today') return showDay(META.today);
    AG.range = { key: b.dataset.key, label: b.dataset.label, from: b.dataset.from, to: b.dataset.to };
    loadAgenda();
  }));
}
function openPeriod() {
  renderPeriodPop();
  const pop = $('#periodPop');
  pop.hidden = false;
  pop.classList.remove('align-right');
  if (pop.getBoundingClientRect().right > window.innerWidth - 12) pop.classList.add('align-right');
  $('#periodBtn').setAttribute('aria-expanded', 'true');
}
function closePeriod() {
  $('#periodPop').hidden = true;
  $('#periodBtn').setAttribute('aria-expanded', 'false');
}
$('#periodBtn').addEventListener('click', () => ($('#periodPop').hidden ? openPeriod() : closePeriod()));
document.addEventListener('click', (e) => { if (!$('#periodPop').hidden && !e.target.closest('#period')) closePeriod(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#periodPop').hidden) closePeriod(); });

// ---------- New appointment modal ----------
$('#newApptBtn').addEventListener('click', () => openApptModal({}));

function openApptModal(pre) {
  const svcOpts = META.services.map((s) => `<option value="${s.id}" ${pre.service_id == s.id ? 'selected' : ''}>${esc(s.name)} — ${eur(s.price_cents)} (${s.duration_min} dk)</option>`).join('');
  const barOpts = META.barbers.map((b) => `<option value="${b.id}" ${pre.barber_id == b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  openModal(`
    <h3>Yeni Randevu</h3>
    <div class="form-grid">
      <label>Müşteri ara
        <input type="text" id="apCustSearch" placeholder="İsim yaz… (yoksa yeni oluşturulur)" autocomplete="off" />
        <div class="cust-suggest" id="apSuggest" hidden></div>
      </label>
      <input type="hidden" id="apCustId" />
      <label id="apPhoneWrap">Telefon (yeni müşteri için)
        <input type="text" id="apCustPhone" />
      </label>
      <div class="form-row">
        <label>Berber<select id="apBarber">${barOpts}</select></label>
        <label>Hizmet<select id="apService">${svcOpts}</select></label>
      </div>
      <div class="form-row">
        <label>Tarih<input type="date" id="apDate" value="${pre.date || $('#agendaDate').value}" /></label>
        <label>Saat
          <div class="time-pick">
            <select id="apHour"></select><span>:</span>
            <select id="apMin">${['00', '10', '20', '30', '40', '50'].map((m) => `<option>${m}</option>`).join('')}</select>
          </div>
        </label>
      </div>
      <p class="muted small-note" id="apDayNote" hidden></p>
      <label>Not<input type="text" id="apNote" /></label>
      <button class="btn btn-gold" id="apSave">Kaydet</button>
    </div>
  `);

  const [preH, preM] = (pre.time || '10:00').split(':');
  const fillHours = (keep) => {
    const h = META.hours[new Date($('#apDate').value + 'T00:00:00').getDay()];
    const open = h ? Number(h[0].slice(0, 2)) : 8;
    const close = h ? Number(h[1].slice(0, 2)) - (h[1].endsWith(':00') ? 1 : 0) : 20;
    const from = Math.min(open, Number(keep)), to = Math.max(close, Number(keep));
    $('#apHour').innerHTML = Array.from({ length: to - from + 1 }, (_, i) => String(from + i).padStart(2, '0'))
      .map((x) => `<option>${x}</option>`).join('');
    $('#apHour').value = String(keep).padStart(2, '0');
    const note = $('#apDayNote');
    note.hidden = !!h;
    note.textContent = h ? '' : 'Bu gün normalde kapalı.';
  };
  fillHours(preH);
  $('#apMin').value = String(Math.floor(Number(preM) / 10) * 10).padStart(2, '0');
  $('#apDate').addEventListener('change', () => fillHours($('#apHour').value));

  const search = $('#apCustSearch');
  let selCust = null;
  search.addEventListener('input', async () => {
    selCust = null; $('#apCustId').value = '';
    const q = search.value.trim();
    const box = $('#apSuggest');
    if (q.length < 2) { box.hidden = true; return; }
    const rows = await api('/customers?q=' + encodeURIComponent(q));
    box.innerHTML = rows.slice(0, 8).map((c) =>
      `<div data-id="${c.id}" data-name="${esc(c.name)}">${esc(c.name)} <span class="muted">${esc(c.phone)}</span> ${c.blacklisted ? '<span class="bl-tag">kara liste</span>' : ''}</div>`
    ).join('') || '<div class="muted">Bulunamadı — yeni müşteri olarak eklenecek</div>';
    box.hidden = false;
    box.querySelectorAll('[data-id]').forEach((d) => d.addEventListener('click', () => {
      selCust = d.dataset.id;
      $('#apCustId').value = d.dataset.id;
      search.value = d.dataset.name;
      box.hidden = true;
    }));
  });

  $('#apSave').addEventListener('click', async (ev) => {
    const body = {
      customer_id: $('#apCustId').value || undefined,
      customer_name: $('#apCustId').value ? undefined : search.value.trim(),
      customer_phone: $('#apCustPhone').value,
      barber_id: Number($('#apBarber').value),
      service_id: Number($('#apService').value),
      date: $('#apDate').value,
      start_time: $('#apHour').value + ':' + $('#apMin').value,
      note: $('#apNote').value,
    };
    const ok = await saveWith(ev.currentTarget, async () => {
      if (!body.customer_id && !body.customer_name) throw new Error('Müşteri seç veya isim yaz');
      // Kara liste / çakışma uyarısında onay alınırsa bayrak eklenip yeniden denenir
      let extra = {};
      for (;;) {
        try {
          await api('/appointments', { method: 'POST', body: { ...body, ...extra } });
          return;
        } catch (e) {
          if (!e.data?.blacklisted && !e.data?.conflict) throw e;
          const q = e.data.blacklisted ? 'Yine de randevu oluşturulsun mu?' : 'Çakışmaya rağmen kaydedilsin mi?';
          if (!(await uiConfirm(e.message + '\n\n' + q))) throw cancelled();
          extra = { ...extra, force: true, ...(e.data.conflict ? { force_overlap: true } : {}) };
        }
      }
    });
    if (ok) closeAfterSave(afterApptChange);
  });
}

// ---------- Slots ----------
const DOW_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const MONTHS_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const SLOT = { days: 14, byBarber: {}, barberId: null, date: null, req: 0 };

function relDay(date) {
  const d = new Date(date + 'T00:00:00');
  const diff = Math.round((d - new Date(META.today + 'T00:00:00')) / 86400000);
  if (diff === 0) return 'Bugün';
  if (diff === 1) return 'Yarın';
  return DOW_SHORT[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS_TR[d.getMonth()].slice(0, 3);
}
function longDate(date) {
  const d = new Date(date + 'T00:00:00');
  return DAYS_TR[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS_TR[d.getMonth()];
}
function afterApptChange() {
  loadAgenda(); loadStats();
  if ($('#tab-slots').classList.contains('active')) loadSlots();
}

async function loadSlots() {
  const req = ++SLOT.req;
  const svc = $('#slotService').selectedOptions[0];
  const dur = svc ? Number(svc.dataset.dur) : 30;
  $('#barberCards').innerHTML = META.barbers.map(() => '<div class="skeleton"></div>').join('');
  $('#dayStrip').innerHTML = '';
  $('#dayPanel').innerHTML = '';
  let results;
  try {
    results = await Promise.all(META.barbers.map((b) => api(`/slots?barber_id=${b.id}&duration=${dur}&days=${SLOT.days}`)));
  } catch (e) {
    if (req === SLOT.req) toast(e.message, true);
    return;
  }
  if (req !== SLOT.req) return; // bu arada filtre değişti, eski cevabı at
  SLOT.byBarber = {};
  META.barbers.forEach((b, i) => { SLOT.byBarber[b.id] = results[i]; });
  if (!SLOT.byBarber[SLOT.barberId]) {
    const key = (b) => { const e = SLOT.byBarber[b.id].earliest; return e ? e.date + e.time : '~'; };
    SLOT.barberId = [...META.barbers].sort((a, b) => key(a).localeCompare(key(b)))[0].id;
  }
  SLOT.date = SLOT.byBarber[SLOT.barberId].earliest?.date || null;
  renderSlots(true);
}

function renderSlots(scrollStrip) {
  const svcId = $('#slotService').value;
  const barber = META.barbers.find((b) => b.id === SLOT.barberId);
  const data = SLOT.byBarber[SLOT.barberId];
  const book = (date, time, barberId) => openApptModal({ date, time, barber_id: barberId, service_id: svcId });

  $('#barberCards').innerHTML = META.barbers.map((b) => {
    const e = SLOT.byBarber[b.id]?.earliest;
    return `
    <div class="barber-card ${b.id === SLOT.barberId ? 'on' : ''}" data-barber="${b.id}" tabindex="0" role="button">
      <div class="bc-name">${esc(b.name)}</div>
      <div class="bc-label">En yakın boş saat</div>
      <div class="bc-row">
        ${e
          ? `<span class="bc-when">${relDay(e.date)} · ${e.time}</span>
             <button type="button" class="btn small btn-gold" data-book="${b.id}">Randevu aç</button>`
          : '<span class="bc-none">Bu aralıkta boş saat yok</span>'}
      </div>
    </div>`;
  }).join('');
  $('#barberCards').querySelectorAll('.barber-card').forEach((card) => {
    const select = () => {
      SLOT.barberId = Number(card.dataset.barber);
      SLOT.date = SLOT.byBarber[SLOT.barberId].earliest?.date || null;
      renderSlots(true);
    };
    card.addEventListener('click', select);
    card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target === card) select(); });
  });
  $('#barberCards').querySelectorAll('[data-book]').forEach((btn) => btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const e = SLOT.byBarber[btn.dataset.book].earliest;
    book(e.date, e.time, Number(btn.dataset.book));
  }));

  if (!data) return;
  $('#dayStrip').innerHTML = data.days.map((d) => {
    const n = d.slots.length;
    const full = !d.closed && !d.past && !n;
    const label = d.closed ? 'Kapalı' : d.past ? 'Kapandı' : full ? 'Dolu' : n + ' boş';
    return `
    <button type="button" class="day-pill ${d.date === SLOT.date ? 'on' : ''} ${full ? 'full' : ''}" data-date="${d.date}" ${n ? '' : 'disabled'}>
      <span class="dp-dow">${d.date === META.today ? 'Bugün' : DOW_SHORT[d.dow]}</span>
      <span class="dp-num">${new Date(d.date + 'T00:00:00').getDate()}</span>
      <span class="dp-count">${label}</span>
    </button>`;
  }).join('');
  $('#dayStrip').querySelectorAll('.day-pill:not(:disabled)').forEach((p) => p.addEventListener('click', () => {
    SLOT.date = p.dataset.date;
    renderSlots(false);
  }));
  if (scrollStrip) {
    const strip = $('#dayStrip'), on = strip.querySelector('.day-pill.on');
    const x = on ? on.offsetLeft - strip.offsetLeft : 0;
    strip.scrollLeft = x + (on ? on.offsetWidth : 0) > strip.clientWidth ? x - 8 : 0;
  }

  const day = data.days.find((d) => d.date === SLOT.date);
  if (!day) {
    $('#dayPanel').innerHTML = `<div class="empty">${esc(barber.name)} için bu aralıkta boş saat yok. Aralığı genişletmeyi dene.</div>`;
    return;
  }
  const groups = [
    ['Sabah', (t) => t < '12:00'],
    ['Öğleden sonra', (t) => t >= '12:00' && t < '17:00'],
    ['Akşam', (t) => t >= '17:00'],
  ];
  $('#dayPanel').innerHTML = `
    <div class="day-panel">
      <div class="dpn-head">
        <h3>${longDate(day.date)}</h3>
        <span class="muted">${esc(barber.name)} · ${day.slots.length} boş saat</span>
      </div>
      ${groups.map(([title, inGroup]) => {
        const times = day.slots.filter(inGroup);
        return times.length ? `
        <div class="slot-group">
          <h4>${title}</h4>
          <div class="slot-grid">${times.map((t) => `<button type="button" class="slot-chip" data-time="${t}">${t}</button>`).join('')}</div>
        </div>` : '';
      }).join('')}
    </div>`;
  $('#dayPanel').querySelectorAll('.slot-chip').forEach((c) =>
    c.addEventListener('click', () => book(day.date, c.dataset.time, SLOT.barberId)));
}

// Masaüstünde gün şeridini fareyle tutup sürükleyerek kaydırma (dokunmatikte zaten yerel kaydırma var)
(function dragScroll(el) {
  let down = false, moved = false, startX = 0, startLeft = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    down = true; moved = false; startX = e.clientX; startLeft = el.scrollLeft;
  });
  window.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) > 5) { moved = true; el.classList.add('dragging'); }
    if (moved) el.scrollLeft = startLeft - dx;
  });
  window.addEventListener('pointerup', () => {
    if (!down) return;
    down = false;
    el.classList.remove('dragging');
  });
  // sürükleme bitince bırakılan günün seçilmesini engelle
  el.addEventListener('click', (e) => {
    if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; }
  }, true);
})($('#dayStrip'));

$('#slotService').addEventListener('change', loadSlots);
$('#slotRange').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  $('#slotRange .on').classList.remove('on');
  b.classList.add('on');
  SLOT.days = Number(b.dataset.days);
  loadSlots();
}));

// ---------- Customers ----------
let custTimer;
$('#custSearch').addEventListener('input', () => { clearTimeout(custTimer); custTimer = setTimeout(loadCustomers, 250); });
$('#newCustBtn').addEventListener('click', () => {
  openModal(`
    <h3>Yeni Müşteri</h3>
    <div class="form-grid">
      <label>İsim<input id="ncName" /></label>
      <label>Telefon<input id="ncPhone" /></label>
      <label>Not<input id="ncNotes" /></label>
      <button class="btn btn-gold" id="ncSave">Kaydet</button>
    </div>`);
  $('#ncSave').addEventListener('click', async (ev) => {
    const ok = await saveWith(ev.currentTarget, () =>
      api('/customers', { method: 'POST', body: { name: $('#ncName').value, phone: $('#ncPhone').value, notes: $('#ncNotes').value } }));
    if (ok) closeAfterSave(loadCustomers);
  });
});

async function loadCustomers() {
  const rows = await api('/customers?q=' + encodeURIComponent($('#custSearch').value.trim()));
  $('#custList').innerHTML = rows.length ? `
    <table>
      <tr><th>İsim</th><th>Telefon</th><th>Randevu</th><th>Gelmedi</th><th>Açık ceza</th><th></th></tr>
      ${rows.map((c) => `
        <tr>
          <td><a href="#" class="cust-link" data-hist="${c.id}">${esc(c.name)}</a> ${c.blacklisted ? '<span class="badge bl">Kara liste</span>' : ''}</td>
          <td>${esc(c.phone)}</td>
          <td>${c.appt_count}</td>
          <td>${c.no_show_count > 0 ? `<span style="color:var(--red)">${c.no_show_count}</span>` : '0'}</td>
          <td>${c.open_penalty_cents > 0 ? `<b style="color:var(--orange)">${eur(c.open_penalty_cents)}</b>` : '—'}</td>
          <td>
            <button class="btn small btn-ghost" data-editc="${c.id}">Düzenle</button>
            ${c.blacklisted
              ? `<button class="btn small" data-unbl="${c.id}">Listeden çıkar</button>`
              : `<button class="btn small danger" data-bl="${c.id}" data-name="${esc(c.name)}">Kara listeye ekle</button>`}
          </td>
        </tr>`).join('')}
    </table>` : '<div class="empty">Müşteri yok</div>';
  bindBlacklistButtons($('#custList'), loadCustomers);
  $('#custList').querySelectorAll('[data-hist]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    openCustomerHistory(rows.find((x) => x.id == a.dataset.hist));
  }));
  $('#custList').querySelectorAll('[data-editc]').forEach((b) => b.addEventListener('click', () => {
    const c = rows.find((x) => x.id == b.dataset.editc);
    openModal(`
      <h3>Müşteriyi Düzenle</h3>
      <div class="form-grid">
        <label>İsim<input id="ecName" value="${esc(c.name)}" /></label>
        <label>Telefon<input id="ecPhone" value="${esc(c.phone)}" /></label>
        <label>Not<input id="ecNotes" value="${esc(c.notes)}" /></label>
        <button class="btn btn-gold" id="ecSave">Kaydet</button>
      </div>`);
    $('#ecSave').addEventListener('click', async (ev) => {
      const ok = await saveWith(ev.currentTarget, () => {
        if (!$('#ecName').value.trim()) throw new Error('İsim boş olamaz');
        return api('/customers/' + c.id, { method: 'PATCH', body: { name: $('#ecName').value.trim(), phone: $('#ecPhone').value, notes: $('#ecNotes').value } });
      });
      if (ok) closeAfterSave(loadCustomers);
    });
  }));
}

function bindBlacklistButtons(root, refresh) {
  root.querySelectorAll('[data-bl]').forEach((b) => b.addEventListener('click', async () => {
    const reason = await uiPrompt(`"${b.dataset.name}" kara listeye eklenecek.\nSebep:`);
    if (reason === null) return;
    api('/customers/' + b.dataset.bl, { method: 'PATCH', body: { blacklisted: true, blacklist_reason: reason } })
      .then(() => { toast('Kara listeye eklendi'); refresh(); loadStats(); })
      .catch((e) => toast(e.message, true));
  }));
  root.querySelectorAll('[data-unbl]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await uiConfirm('Kara listeden çıkarılsın mı?'))) return;
    api('/customers/' + b.dataset.unbl, { method: 'PATCH', body: { blacklisted: false } })
      .then(() => { toast('Listeden çıkarıldı'); refresh(); loadStats(); })
      .catch((e) => toast(e.message, true));
  }));
}

// ---------- Customer history ----------
async function openCustomerHistory(c) {
  const [appts, pens] = await Promise.all([
    api('/appointments?order=desc&customer_id=' + c.id),
    api('/penalties'),
  ]);
  const myPens = pens.rows.filter((p) => p.customer_id === c.id);
  const PEN_TR = { open: 'Açık', paid: 'Ödendi', waived: 'Silindi' };
  openModal(`
    <h3>${esc(c.name)}</h3>
    <p class="muted" style="margin:-10px 0 14px">${esc(c.phone) || 'Telefon yok'}
      ${c.blacklisted ? ' · <span class="badge bl">Kara liste</span>' : ''}
      ${c.notes ? '<br/>Not: ' + esc(c.notes) : ''}</p>
    <div class="hist-stats">
      <span><b>${appts.length}</b> randevu</span>
      <span><b>${c.no_show_count}</b> gelmedi</span>
      <span>Açık ceza: <b>${c.open_penalty_cents > 0 ? eur(c.open_penalty_cents) : '—'}</b></span>
    </div>
    ${myPens.length ? `
      <h4 class="hist-head">Cezalar</h4>
      ${myPens.map((p) => `
        <div class="hist-row">
          <span>${p.appt_date ? fmtDate(p.appt_date) : (p.created_at || '').slice(0, 10)}</span>
          <span><b>${eur(p.amount_cents)}</b></span>
          <span class="badge ${p.status === 'open' ? 'no_show' : 'completed'}">${PEN_TR[p.status]}</span>
        </div>`).join('')}` : ''}
    <h4 class="hist-head">Randevular</h4>
    ${appts.length ? appts.map((a) => `
      <div class="hist-row">
        <span>${fmtDate(a.date)} · ${a.start_time}</span>
        <span class="muted">${esc(a.barber_name)} · ${esc(a.service_name || '—')}</span>
        <span class="badge ${a.status}">${STATUS_TR[a.status]}</span>
      </div>`).join('') : '<p class="muted">Randevu geçmişi yok.</p>'}
  `);
}

// ---------- Penalties ----------
$('#penStatus').addEventListener('change', loadPenalties);
async function loadPenalties() {
  const st = $('#penStatus').value;
  const r = await api('/penalties' + (st ? '?status=' + st : ''));
  $('#penTotal').textContent = 'Toplam açık: ' + eur(r.open_total_cents);
  const PEN_TR = { open: 'Açık', paid: 'Ödendi', waived: 'Silindi' };
  $('#penList').innerHTML = r.rows.length ? `
    <table>
      <tr><th>Müşteri</th><th>Tutar</th><th>Randevu</th><th>Durum</th><th>Tarih</th><th></th></tr>
      ${r.rows.map((p) => `
        <tr>
          <td>${esc(p.customer_name)}<br /><span class="muted">${esc(p.customer_phone)}</span></td>
          <td><b>${eur(p.amount_cents)}</b></td>
          <td>${p.appt_date ? fmtDate(p.appt_date) + ' ' + p.appt_time : '—'}</td>
          <td><span class="badge ${p.status === 'open' ? 'no_show' : 'completed'}">${PEN_TR[p.status]}</span></td>
          <td class="muted">${p.created_at?.slice(0, 10) || ''}</td>
          <td>${p.status === 'open' ? `
            <button class="btn small" data-pay="${p.id}">Ödendi</button>
            <button class="btn small btn-ghost" data-waive="${p.id}">Affet</button>` : ''}
          </td>
        </tr>`).join('')}
    </table>` : '<div class="empty">Ceza kaydı yok</div>';
  $('#penList').querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () =>
    api('/penalties/' + b.dataset.pay, { method: 'PATCH', body: { status: 'paid' } }).then(() => { loadPenalties(); loadStats(); })));
  $('#penList').querySelectorAll('[data-waive]').forEach((b) => b.addEventListener('click', () =>
    api('/penalties/' + b.dataset.waive, { method: 'PATCH', body: { status: 'waived' } }).then(() => { loadPenalties(); loadStats(); })));
}

// ---------- Blacklist ----------
async function loadBlacklist() {
  const rows = (await api('/customers')).filter((c) => c.blacklisted);
  $('#blackList').innerHTML = rows.length ? `
    <table>
      <tr><th>İsim</th><th>Telefon</th><th>Sebep</th><th>Eklendi</th><th></th></tr>
      ${rows.map((c) => `
        <tr>
          <td>${esc(c.name)}</td>
          <td>${esc(c.phone)}</td>
          <td>${esc(c.blacklist_reason) || '—'}</td>
          <td class="muted">${c.blacklisted_at?.slice(0, 10) || ''}</td>
          <td><button class="btn small" data-unbl="${c.id}">Listeden çıkar</button></td>
        </tr>`).join('')}
    </table>` : '<div class="empty">Kara liste boş. Müşteriler sekmesinden kişi ekleyebilirsin.</div>';
  bindBlacklistButtons($('#blackList'), loadBlacklist);
}

// ---------- Settings ----------
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Pzt..Paz
async function refreshMeta() {
  META = await api('/meta');
  fillSelects();
}

async function loadSettings() {
  const [barbers, services] = await Promise.all([api('/barbers'), api('/services')]);

  $('#setBarbers').innerHTML = barbers.map((b) => `
    <div class="set-row ${b.active ? '' : 'inactive'}">
      <span class="grow">${esc(b.name)}${b.active ? '' : ' <span class="muted">(pasif)</span>'}</span>
      ${b.active ? `
        <button class="btn small btn-ghost" data-rename="${b.id}" data-name="${esc(b.name)}">Adlandır</button>
        <button class="btn small btn-ghost danger" data-deact="${b.id}" data-name="${esc(b.name)}">Kaldır</button>` : `
        <button class="btn small" data-react="${b.id}">Geri al</button>`}
    </div>`).join('');
  $('#setBarbers').querySelectorAll('[data-rename]').forEach((b) => b.addEventListener('click', async () => {
    const name = await uiPrompt(`"${b.dataset.name}" için yeni isim:`);
    if (!name || !name.trim()) return;
    try { await api('/barbers/' + b.dataset.rename, { method: 'PATCH', body: { name } }); await refreshMeta(); loadSettings(); }
    catch (e) { toast(e.message, true); }
  }));
  $('#setBarbers').querySelectorAll('[data-deact]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await uiConfirm(`"${b.dataset.name}" listeden kaldırılacak.\nGeçmiş randevuları silinmez, yeni randevu alınamaz.`))) return;
    try { await api('/barbers/' + b.dataset.deact, { method: 'PATCH', body: { active: false } }); await refreshMeta(); loadSettings(); toast('Berber kaldırıldı'); }
    catch (e) { toast(e.message, true); }
  }));
  $('#setBarbers').querySelectorAll('[data-react]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('/barbers/' + b.dataset.react, { method: 'PATCH', body: { active: true } }); await refreshMeta(); loadSettings(); }
    catch (e) { toast(e.message, true); }
  }));

  $('#setServices').innerHTML = `
    <table>
      <tr><th>Hizmet</th><th>Fiyat</th><th>Süre</th><th></th></tr>
      ${services.map((s) => `
        <tr class="${s.active ? '' : 'inactive'}" style="${s.active ? '' : 'opacity:.45'}">
          <td>${esc(s.name)}${s.active ? '' : ' <span class="muted">(pasif)</span>'}</td>
          <td>${eur(s.price_cents)}</td>
          <td>${s.duration_min} dk</td>
          <td style="text-align:right">
            ${s.active ? `
              <button class="btn small btn-ghost" data-editsvc="${s.id}">Düzenle</button>
              <button class="btn small btn-ghost danger" data-deactsvc="${s.id}" data-name="${esc(s.name)}">Kaldır</button>` : `
              <button class="btn small" data-reactsvc="${s.id}">Geri al</button>`}
          </td>
        </tr>`).join('')}
    </table>`;
  $('#setServices').querySelectorAll('[data-editsvc]').forEach((b) => b.addEventListener('click', () => {
    const s = services.find((x) => x.id == b.dataset.editsvc);
    openModal(`
      <h3>Hizmeti Düzenle</h3>
      <div class="form-grid">
        <label>İsim<input id="esName" value="${esc(s.name)}" /></label>
        <div class="form-row">
          <label>Fiyat (€)<input type="number" id="esPrice" min="0" step="0.5" value="${(s.price_cents / 100).toFixed(2)}" /></label>
          <label>Süre (dk)<input type="number" id="esDur" min="5" step="5" value="${s.duration_min}" /></label>
        </div>
        <button class="btn btn-gold" id="esSave">Kaydet</button>
      </div>`);
    $('#esSave').addEventListener('click', async (ev) => {
      const ok = await saveWith(ev.currentTarget, async () => {
        await api('/services/' + s.id, { method: 'PATCH', body: {
          name: $('#esName').value,
          price_cents: Math.round(Number($('#esPrice').value) * 100),
          duration_min: Number($('#esDur').value),
        } });
        await refreshMeta();
      });
      if (ok) closeAfterSave(loadSettings);
    });
  }));
  $('#setServices').querySelectorAll('[data-deactsvc]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await uiConfirm(`"${b.dataset.name}" hizmeti listeden kaldırılacak. Onaylıyor musun?`))) return;
    try { await api('/services/' + b.dataset.deactsvc, { method: 'PATCH', body: { active: false } }); await refreshMeta(); loadSettings(); }
    catch (e) { toast(e.message, true); }
  }));
  $('#setServices').querySelectorAll('[data-reactsvc]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('/services/' + b.dataset.reactsvc, { method: 'PATCH', body: { active: true } }); await refreshMeta(); loadSettings(); }
    catch (e) { toast(e.message, true); }
  }));

  $('#setHours').innerHTML = DAY_ORDER.map((d) => {
    const h = META.hours[d];
    return `
    <div class="hours-row" data-day="${d}">
      <span class="day-name">${DAYS_TR[d]}</span>
      <input type="time" class="h-open" value="${h ? h[0] : '09:00'}" ${h ? '' : 'disabled'} />
      <span class="muted">–</span>
      <input type="time" class="h-close" value="${h ? h[1] : '18:00'}" ${h ? '' : 'disabled'} />
      <label class="closed-toggle"><input type="checkbox" class="h-closed" ${h ? '' : 'checked'} /> Kapalı</label>
    </div>`;
  }).join('');
  $('#setHours').querySelectorAll('.h-closed').forEach((cb) => cb.addEventListener('change', () => {
    const row = cb.closest('.hours-row');
    row.querySelector('.h-open').disabled = cb.checked;
    row.querySelector('.h-close').disabled = cb.checked;
  }));

  $('#setFee').value = (META.no_show_fee_cents / 100).toFixed(2);
}

$('#addBarberBtn').addEventListener('click', (ev) => saveWith(ev.currentTarget, async () => {
  const name = $('#newBarberName').value.trim();
  if (!name) throw new Error('Berber adı yaz');
  await api('/barbers', { method: 'POST', body: { name } });
  $('#newBarberName').value = '';
  await refreshMeta();
  loadSettings();
}, 'Eklendi'));
$('#addSvcBtn').addEventListener('click', (ev) => saveWith(ev.currentTarget, async () => {
  await api('/services', { method: 'POST', body: {
    name: $('#newSvcName').value,
    price_cents: Math.round(Number($('#newSvcPrice').value) * 100),
    duration_min: Number($('#newSvcDur').value),
  } });
  $('#newSvcName').value = ''; $('#newSvcPrice').value = ''; $('#newSvcDur').value = '';
  await refreshMeta();
  loadSettings();
}, 'Eklendi'));
$('#saveHoursBtn').addEventListener('click', (ev) => saveWith(ev.currentTarget, async () => {
  const hours = {};
  $('#setHours').querySelectorAll('.hours-row').forEach((row) => {
    hours[row.dataset.day] = row.querySelector('.h-closed').checked
      ? null
      : [row.querySelector('.h-open').value, row.querySelector('.h-close').value];
  });
  await api('/settings', { method: 'PATCH', body: { hours } });
  await refreshMeta();
}));
$('#saveFeeBtn').addEventListener('click', (ev) => saveWith(ev.currentTarget, async () => {
  await api('/settings', { method: 'PATCH', body: { no_show_fee_cents: Math.round(Number($('#setFee').value) * 100) } });
  await refreshMeta();
}));
$('#savePassBtn').addEventListener('click', (ev) => saveWith(ev.currentTarget, async () => {
  await api('/settings', { method: 'PATCH', body: { admin_password: $('#setPass').value } });
  $('#setPass').value = '';
}, 'Değiştirildi'));

// ---------- Modal ----------
function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').hidden = false;
}
function closeModal() { $('#modal').hidden = true; }
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) closeModal(); });

// ---------- Init ----------
if (TOKEN) boot(); else showLogin();
