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
  $('#agendaBarber').innerHTML = '<option value="">Tüm berberler</option>' + bOpts;
  $('#slotBarber').innerHTML = bOpts;
  $('#slotService').innerHTML = META.services
    .map((s) => `<option value="${s.id}" data-dur="${s.duration_min}">${esc(s.name)} — ${s.duration_min} dk</option>`)
    .join('');
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
    ({ agenda: loadAgenda, customers: loadCustomers, penalties: loadPenalties, blacklist: loadBlacklist }[btn.dataset.tab] || (() => {}))();
  });
});

// ---------- Agenda ----------
async function loadAgenda() {
  const date = $('#agendaDate').value;
  const params = new URLSearchParams({ date });
  if ($('#agendaBarber').value) params.set('barber_id', $('#agendaBarber').value);
  if ($('#agendaStatus').value) params.set('status', $('#agendaStatus').value);
  const rows = await api('/appointments?' + params);
  const list = $('#agendaList');
  if (!rows.length) {
    list.innerHTML = `<div class="empty">${fmtDate(date)} — randevu yok</div>`;
    return;
  }
  list.innerHTML = rows.map((a) => {
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
  }).join('');

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

$('#agendaDate').addEventListener('change', loadAgenda);
$('#agendaBarber').addEventListener('change', loadAgenda);
$('#agendaStatus').addEventListener('change', loadAgenda);
$('#prevDay').addEventListener('click', () => shiftDay(-1));
$('#nextDay').addEventListener('click', () => shiftDay(1));
$('#todayBtn').addEventListener('click', () => { $('#agendaDate').value = META.today; loadAgenda(); });
function shiftDay(n) {
  const d = new Date($('#agendaDate').value + 'T00:00:00');
  d.setDate(d.getDate() + n);
  $('#agendaDate').value = d.toISOString().slice(0, 10);
  loadAgenda();
}

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
        <label>Saat<input type="time" id="apTime" value="${pre.time || '10:00'}" step="300" /></label>
      </div>
      <label>Not<input type="text" id="apNote" /></label>
      <button class="btn btn-gold" id="apSave">Kaydet</button>
    </div>
  `);

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

  $('#apSave').addEventListener('click', async () => {
    const body = {
      customer_id: $('#apCustId').value || undefined,
      customer_name: $('#apCustId').value ? undefined : search.value.trim(),
      customer_phone: $('#apCustPhone').value,
      barber_id: Number($('#apBarber').value),
      service_id: Number($('#apService').value),
      date: $('#apDate').value,
      start_time: $('#apTime').value,
      note: $('#apNote').value,
    };
    if (!body.customer_id && !body.customer_name) return toast('Müşteri seç veya isim yaz', true);
    try {
      await api('/appointments', { method: 'POST', body });
      closeModal(); toast('Randevu oluşturuldu'); loadAgenda(); loadStats();
    } catch (e) {
      if (e.data?.blacklisted) {
        if (await uiConfirm(e.message + '\n\nYine de randevu oluşturulsun mu?')) {
          try { await api('/appointments', { method: 'POST', body: { ...body, force: true } }); closeModal(); toast('Randevu oluşturuldu (kara liste!)'); loadAgenda(); }
          catch (e2) { toast(e2.message, true); }
        }
      } else if (e.data?.conflict) {
        if (await uiConfirm(e.message + '\n\nÇakışmaya rağmen kaydedilsin mi?')) {
          try { await api('/appointments', { method: 'POST', body: { ...body, force: true, force_overlap: true } }); closeModal(); loadAgenda(); }
          catch (e2) { toast(e2.message, true); }
        }
      } else toast(e.message, true);
    }
  });
}

// ---------- Slots ----------
$('#findSlots').addEventListener('click', loadSlots);
async function loadSlots() {
  const barberId = $('#slotBarber').value;
  const svc = $('#slotService').selectedOptions[0];
  const dur = svc ? Number(svc.dataset.dur) : 30;
  const days = Number($('#slotDays').value) || 14;
  const r = await api(`/slots?barber_id=${barberId}&duration=${dur}&days=${days}`);
  const box = $('#earliestBox');
  if (r.earliest) {
    box.hidden = false;
    box.innerHTML = `<span class="earliest-label">En yakın boş saat</span> <b>${fmtDate(r.earliest.date)} · ${r.earliest.time}</b> <button class="btn small btn-gold" id="bookEarliest">Randevu aç</button>`;
    $('#bookEarliest').addEventListener('click', () =>
      openApptModal({ date: r.earliest.date, time: r.earliest.time, barber_id: barberId, service_id: svc?.value }));
  } else {
    box.hidden = false;
    box.innerHTML = 'Bu aralıkta boş saat yok.';
  }
  $('#slotResults').innerHTML = r.days.map((d) => `
    <div class="slot-day">
      <h4>${fmtDate(d.date)} <span class="muted">(${d.slots.length} boş)</span></h4>
      <div class="slot-chips">${d.slots.map((s) => `<button class="slot-chip" data-date="${d.date}" data-time="${s}">${s}</button>`).join('')}</div>
    </div>`).join('') || '<div class="empty">Boş saat bulunamadı</div>';
  $('#slotResults').querySelectorAll('.slot-chip').forEach((c) =>
    c.addEventListener('click', () => openApptModal({ date: c.dataset.date, time: c.dataset.time, barber_id: barberId, service_id: svc?.value })));
}

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
  $('#ncSave').addEventListener('click', async () => {
    try {
      await api('/customers', { method: 'POST', body: { name: $('#ncName').value, phone: $('#ncPhone').value, notes: $('#ncNotes').value } });
      closeModal(); toast('Müşteri eklendi'); loadCustomers();
    } catch (e) { toast(e.message, true); }
  });
});

async function loadCustomers() {
  const rows = await api('/customers?q=' + encodeURIComponent($('#custSearch').value.trim()));
  $('#custList').innerHTML = rows.length ? `
    <table>
      <tr><th>İsim</th><th>Telefon</th><th>Randevu</th><th>Gelmedi</th><th>Açık ceza</th><th></th></tr>
      ${rows.map((c) => `
        <tr>
          <td>${esc(c.name)} ${c.blacklisted ? '<span class="badge bl">Kara liste</span>' : ''}</td>
          <td>${esc(c.phone)}</td>
          <td>${c.appt_count}</td>
          <td>${c.no_show_count > 0 ? `<span style="color:var(--red)">${c.no_show_count}</span>` : '0'}</td>
          <td>${c.open_penalty_cents > 0 ? `<b style="color:var(--orange)">${eur(c.open_penalty_cents)}</b>` : '—'}</td>
          <td>
            ${c.blacklisted
              ? `<button class="btn small" data-unbl="${c.id}">Listeden çıkar</button>`
              : `<button class="btn small danger" data-bl="${c.id}" data-name="${esc(c.name)}">Kara listeye ekle</button>`}
          </td>
        </tr>`).join('')}
    </table>` : '<div class="empty">Müşteri yok</div>';
  bindBlacklistButtons($('#custList'), loadCustomers);
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
