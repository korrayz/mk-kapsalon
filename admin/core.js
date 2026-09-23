// MK Kapsalon — Admin API çekirdeği.
// Lokalde file:kapsalon.db, Vercel'de TURSO_DATABASE_URL + TURSO_AUTH_TOKEN ile çalışır.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createClient } = require('@libsql/client');

const SECRET = process.env.ADMIN_SECRET || 'mk-dev-secret';
const IS_REMOTE = !!process.env.TURSO_DATABASE_URL;

let client;
function db() {
  if (!client) {
    if (!IS_REMOTE) {
      const dataDir = path.join(__dirname, 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    }
    client = createClient({
      url: process.env.TURSO_DATABASE_URL || 'file:' + path.join(__dirname, 'data', 'kapsalon.db'),
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

async function q(sql, args = []) {
  const rs = await db().execute({ sql, args });
  return rs.rows.map((r) => {
    const o = {};
    rs.columns.forEach((c, i) => { o[c] = r[i]; });
    return o;
  });
}
async function run(sql, args = []) {
  const rs = await db().execute({ sql, args });
  return { lastId: rs.lastInsertRowid != null ? Number(rs.lastInsertRowid) : null, changes: rs.rowsAffected };
}
const one = async (sql, args) => (await q(sql, args))[0];

// ---------- Schema + seed ----------
const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS barbers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  price_cents INTEGER NOT NULL, duration_min INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  phone TEXT DEFAULT '', email TEXT DEFAULT '', notes TEXT DEFAULT '',
  blacklisted INTEGER NOT NULL DEFAULT 0, blacklist_reason TEXT DEFAULT '', blacklisted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  barber_id INTEGER NOT NULL REFERENCES barbers(id),
  service_id INTEGER REFERENCES services(id),
  date TEXT NOT NULL, start_time TEXT NOT NULL, duration_min INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date, barber_id);
CREATE TABLE IF NOT EXISTS penalties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  appointment_id INTEGER REFERENCES appointments(id),
  amount_cents INTEGER NOT NULL, reason TEXT DEFAULT 'no_show',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT);
`;

const getSetting = async (key) => (await one('SELECT value FROM settings WHERE key = ?', [key]))?.value;
const setSetting = (key, value) =>
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, String(value)]);

async function initDb() {
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await db().execute(stmt);
  if (!(await getSetting('no_show_fee_cents'))) await setSetting('no_show_fee_cents', '2500');
  if (!(await getSetting('hours'))) {
    await setSetting('hours', JSON.stringify({
      0: null, 1: ['12:00', '18:00'], 2: ['09:00', '18:00'], 3: ['09:00', '18:00'],
      4: ['09:00', '18:00'], 5: ['09:00', '18:00'], 6: ['09:00', '18:00'],
    }));
  }
  if ((await one('SELECT COUNT(*) c FROM barbers')).c === 0) {
    await run('INSERT INTO barbers(name) VALUES (?)', ['Berber 1']);
    await run('INSERT INTO barbers(name) VALUES (?)', ['Berber 2']);
  }
  if ((await one('SELECT COUNT(*) c FROM services')).c === 0) {
    const seed = [
      ['Heren knippen', 2500, 30], ['Studenten', 2200, 30], ['Senioren 65+', 2000, 30],
      ['Tondeuse', 1800, 15], ['Baard modelleren', 1750, 20], ['Hot towel scheren', 2500, 30],
      ['Snor trimmen', 750, 10], ['Nekscheren', 750, 10], ['Knippen + Baard', 3500, 45],
      ['Knippen + Scheren', 4000, 60], ['Vader + Zoon', 4000, 60], ['The Full Service', 4500, 60],
      ['Kinderen t/m 12', 1800, 30], ['Wassen + föhnen', 1000, 15], ['Wenkbrauwen', 750, 10],
      ['Styling & advies', 1000, 15],
    ];
    for (const s of seed) await run('INSERT INTO services(name, price_cents, duration_min) VALUES (?,?,?)', s);
  }
}
let readyPromise;
const ensureReady = () => (readyPromise ||= initDb());

// ---------- Auth (durumsuz, HMAC imzalı token) ----------
function makeToken() {
  const exp = String(Date.now() + 12 * 3600 * 1000);
  const sig = crypto.createHmac('sha256', SECRET).update(exp).digest('hex');
  return exp + '.' + sig;
}
function checkToken(token) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = crypto.createHmac('sha256', SECRET).update(exp).digest('hex');
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
async function adminPassword() {
  // Panelden değiştirilen şifre (DB) öncelikli; yoksa env, o da yoksa varsayılan
  return (await getSetting('admin_password')) || process.env.ADMIN_PASSWORD || 'mk2026';
}

// ---------- Helpers ----------
function toMin(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
function toHHMM(min) { return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }
function todayStr(d = new Date()) {
  // Hollanda saatiyle bugün (sunucu UTC olabilir)
  const nl = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
  return nl.getFullYear() + '-' + String(nl.getMonth() + 1).padStart(2, '0') + '-' + String(nl.getDate()).padStart(2, '0');
}
function nowMinutesNL() {
  const nl = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
  return nl.getHours() * 60 + nl.getMinutes();
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const APPT_SELECT = `
  SELECT a.*, c.name AS customer_name, c.phone AS customer_phone, c.blacklisted,
         b.name AS barber_name, s.name AS service_name, s.price_cents
  FROM appointments a
  JOIN customers c ON c.id = a.customer_id
  JOIN barbers b ON b.id = a.barber_id
  LEFT JOIN services s ON s.id = a.service_id`;

async function hasConflict(barberId, date, startMin, durMin, exceptId) {
  const rows = await q(
    `SELECT start_time, duration_min FROM appointments
     WHERE barber_id = ? AND date = ? AND status IN ('scheduled','completed') AND id != ?`,
    [barberId, date, exceptId || -1]);
  const end = startMin + durMin;
  return rows.some((r) => {
    const s = toMin(r.start_time), e = s + r.duration_min;
    return startMin < e && s < end;
  });
}

// Aralıktaki her günü döndürür (kapalı / geçmiş / dolu günler dahil) — tek sorgu.
async function freeSlots(barberId, durMin, fromDate, days, step) {
  const hours = JSON.parse(await getSetting('hours'));
  const rows = await q(
    `SELECT date, start_time, duration_min FROM appointments
     WHERE barber_id = ? AND date >= ? AND date <= ? AND status IN ('scheduled','completed')`,
    [barberId, fromDate, addDays(fromDate, days - 1)]);
  const byDate = {};
  for (const r of rows) (byDate[r.date] ||= []).push([toMin(r.start_time), toMin(r.start_time) + r.duration_min]);

  const out = [];
  const nowDate = todayStr();
  const nowMin = nowMinutesNL();
  for (let i = 0; i < days; i++) {
    const date = addDays(fromDate, i);
    const dow = new Date(date + 'T00:00:00').getDay();
    const h = hours[dow];
    if (!h) { out.push({ date, dow, closed: true, past: false, slots: [] }); continue; }
    const open = toMin(h[0]), close = toMin(h[1]);
    const appts = byDate[date] || [];
    const slots = [];
    for (let t = open; t + durMin <= close; t += step) {
      if (date === nowDate && t < nowMin) continue;
      if (!appts.some(([s, e]) => t < e && s < t + durMin)) slots.push(toHHMM(t));
    }
    out.push({ date, dow, closed: false, past: date === nowDate && nowMin >= close, slots });
  }
  return out;
}

// ---------- Router ----------
// handle(method, pathname (/api'siz), query: URLSearchParams, body, token) -> {status, data}
async function handle(method, pathname, query, body, token) {
  await ensureReady();

  // Halka açık: sitedeki çalışma saatleri bölümü buradan beslenir
  if (method === 'GET' && pathname === '/public/hours') {
    return {
      status: 200,
      data: { hours: JSON.parse(await getSetting('hours')) },
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    };
  }

  if (method === 'POST' && pathname === '/login') {
    if ((body || {}).password !== (await adminPassword())) return { status: 401, data: { error: 'Hatalı şifre' } };
    return { status: 200, data: { token: makeToken() } };
  }
  if (!checkToken(token)) return { status: 401, data: { error: 'unauthorized' } };

  let m;

  if (method === 'GET' && pathname === '/meta') {
    return { status: 200, data: {
      barbers: await q('SELECT * FROM barbers WHERE active = 1 ORDER BY id'),
      services: await q('SELECT * FROM services WHERE active = 1 ORDER BY id'),
      no_show_fee_cents: Number(await getSetting('no_show_fee_cents')),
      hours: JSON.parse(await getSetting('hours')),
      today: todayStr(),
    } };
  }

  if (method === 'GET' && pathname === '/appointments') {
    let sql = APPT_SELECT + ' WHERE 1=1';
    const args = [];
    if (query.get('date')) { sql += ' AND a.date = ?'; args.push(query.get('date')); }
    if (query.get('from')) { sql += ' AND a.date >= ?'; args.push(query.get('from')); }
    if (query.get('to')) { sql += ' AND a.date <= ?'; args.push(query.get('to')); }
    if (query.get('barber_id')) { sql += ' AND a.barber_id = ?'; args.push(query.get('barber_id')); }
    if (query.get('status')) { sql += ' AND a.status = ?'; args.push(query.get('status')); }
    if (query.get('customer_id')) { sql += ' AND a.customer_id = ?'; args.push(query.get('customer_id')); }
    const order = query.get('order') === 'desc' ? ' ORDER BY a.date DESC, a.start_time DESC' : ' ORDER BY a.date, a.start_time';
    return { status: 200, data: await q(sql + order, args) };
  }

  if (method === 'POST' && pathname === '/appointments') {
    const b = body || {};
    const newName = String(b.customer_name || '').trim();
    if ((!b.customer_id && !newName) || !b.barber_id || !b.date || !b.start_time) {
      return { status: 400, data: { error: 'Eksik alan' } };
    }
    if (b.customer_id) {
      const cust = await one('SELECT * FROM customers WHERE id = ?', [b.customer_id]);
      if (!cust) return { status: 404, data: { error: 'Müşteri bulunamadı' } };
      if (cust.blacklisted && !b.force) {
        return { status: 409, data: { blacklisted: true, error: `"${cust.name}" kara listede: ${cust.blacklist_reason || 'sebep girilmemiş'}` } };
      }
    }
    let dur = Number(b.duration_min) || 0;
    if (!dur && b.service_id) dur = (await one('SELECT duration_min FROM services WHERE id = ?', [b.service_id]))?.duration_min || 30;
    if (!dur) dur = 30;
    if (await hasConflict(b.barber_id, b.date, toMin(b.start_time), dur) && !b.force_overlap) {
      return { status: 409, data: { conflict: true, error: 'Bu saatte berberin başka randevusu var' } };
    }
    // Yeni müşteri tüm kontrollerden sonra açılır; onaylı tekrar denemede çift kayıt oluşmasın
    let customerId = b.customer_id;
    if (!customerId) {
      customerId = (await run('INSERT INTO customers(name, phone) VALUES (?,?)', [newName, String(b.customer_phone || '').trim()])).lastId;
    }
    const r = await run(
      'INSERT INTO appointments(customer_id, barber_id, service_id, date, start_time, duration_min, note) VALUES (?,?,?,?,?,?,?)',
      [customerId, b.barber_id, b.service_id || null, b.date, b.start_time, dur, b.note || '']);
    return { status: 201, data: await one(APPT_SELECT + ' WHERE a.id = ?', [r.lastId]) };
  }

  if ((m = pathname.match(/^\/appointments\/(\d+)$/)) && method === 'PATCH') {
    const id = Number(m[1]);
    const appt = await one('SELECT * FROM appointments WHERE id = ?', [id]);
    if (!appt) return { status: 404, data: { error: 'Randevu yok' } };
    const b = body || {};
    if (b.status) {
      if (!['scheduled', 'completed', 'no_show', 'cancelled'].includes(b.status)) return { status: 400, data: { error: 'Geçersiz durum' } };
      await run('UPDATE appointments SET status = ? WHERE id = ?', [b.status, id]);
      if (b.status === 'no_show' && appt.status !== 'no_show') {
        const fee = Number(await getSetting('no_show_fee_cents'));
        await run('INSERT INTO penalties(customer_id, appointment_id, amount_cents, reason) VALUES (?,?,?,?)', [appt.customer_id, id, fee, 'no_show']);
      }
      if (appt.status === 'no_show' && b.status !== 'no_show') {
        await run("DELETE FROM penalties WHERE appointment_id = ? AND status = 'open'", [id]);
      }
    }
    for (const k of ['date', 'start_time', 'duration_min', 'barber_id', 'service_id', 'note']) {
      if (b[k] !== undefined) await run(`UPDATE appointments SET ${k} = ? WHERE id = ?`, [b[k], id]);
    }
    return { status: 200, data: await one(APPT_SELECT + ' WHERE a.id = ?', [id]) };
  }

  if ((m = pathname.match(/^\/appointments\/(\d+)$/)) && method === 'DELETE') {
    await run("DELETE FROM penalties WHERE appointment_id = ? AND status = 'open'", [m[1]]);
    await run('DELETE FROM appointments WHERE id = ?', [m[1]]);
    return { status: 200, data: { ok: true } };
  }

  if (method === 'GET' && pathname === '/slots') {
    const barberId = Number(query.get('barber_id'));
    if (!barberId) return { status: 400, data: { error: 'barber_id gerekli' } };
    const dur = Number(query.get('duration')) || 30;
    const from = query.get('from') || todayStr();
    const days = Math.min(Number(query.get('days')) || 14, 60);
    const step = Number(query.get('step')) || 30;
    const result = await freeSlots(barberId, dur, from, days, step);
    const firstDay = result.find((d) => d.slots.length);
    const first = firstDay ? { date: firstDay.date, time: firstDay.slots[0] } : null;
    return { status: 200, data: { earliest: first, days: result } };
  }

  if (method === 'GET' && pathname === '/customers') {
    const search = (query.get('q') || '').trim();
    let sql = `
      SELECT c.*,
        (SELECT COUNT(*) FROM appointments a WHERE a.customer_id = c.id) AS appt_count,
        (SELECT COUNT(*) FROM appointments a WHERE a.customer_id = c.id AND a.status = 'no_show') AS no_show_count,
        (SELECT COALESCE(SUM(p.amount_cents),0) FROM penalties p WHERE p.customer_id = c.id AND p.status = 'open') AS open_penalty_cents
      FROM customers c`;
    const args = [];
    if (search) { sql += ' WHERE c.name LIKE ? OR c.phone LIKE ?'; args.push(`%${search}%`, `%${search}%`); }
    return { status: 200, data: await q(sql + ' ORDER BY c.name LIMIT 200', args) };
  }

  if (method === 'POST' && pathname === '/customers') {
    const b = body || {};
    if (!b.name || !b.name.trim()) return { status: 400, data: { error: 'İsim gerekli' } };
    const r = await run('INSERT INTO customers(name, phone, email, notes) VALUES (?,?,?,?)',
      [b.name.trim(), (b.phone || '').trim(), (b.email || '').trim(), b.notes || '']);
    return { status: 201, data: await one('SELECT * FROM customers WHERE id = ?', [r.lastId]) };
  }

  if ((m = pathname.match(/^\/customers\/(\d+)$/)) && method === 'PATCH') {
    const id = Number(m[1]);
    const b = body || {};
    if (b.blacklisted !== undefined) {
      await run('UPDATE customers SET blacklisted = ?, blacklist_reason = ?, blacklisted_at = ? WHERE id = ?',
        [b.blacklisted ? 1 : 0, b.blacklisted ? (b.blacklist_reason || '') : '', b.blacklisted ? new Date().toISOString() : null, id]);
    }
    for (const k of ['name', 'phone', 'email', 'notes']) {
      if (b[k] !== undefined) await run(`UPDATE customers SET ${k} = ? WHERE id = ?`, [b[k], id]);
    }
    return { status: 200, data: await one('SELECT * FROM customers WHERE id = ?', [id]) };
  }

  if (method === 'GET' && pathname === '/penalties') {
    const status = query.get('status');
    let sql = `
      SELECT p.*, c.name AS customer_name, c.phone AS customer_phone,
             a.date AS appt_date, a.start_time AS appt_time
      FROM penalties p
      JOIN customers c ON c.id = p.customer_id
      LEFT JOIN appointments a ON a.id = p.appointment_id`;
    const args = [];
    if (status) { sql += ' WHERE p.status = ?'; args.push(status); }
    const rows = await q(sql + ' ORDER BY p.created_at DESC LIMIT 300', args);
    const openTotal = (await one("SELECT COALESCE(SUM(amount_cents),0) t FROM penalties WHERE status = 'open'")).t;
    return { status: 200, data: { rows, open_total_cents: openTotal } };
  }

  if ((m = pathname.match(/^\/penalties\/(\d+)$/)) && method === 'PATCH') {
    const b = body || {};
    if (!['open', 'paid', 'waived'].includes(b.status)) return { status: 400, data: { error: 'Geçersiz durum' } };
    await run('UPDATE penalties SET status = ?, resolved_at = ? WHERE id = ?',
      [b.status, b.status === 'open' ? null : new Date().toISOString(), m[1]]);
    return { status: 200, data: { ok: true } };
  }

  if (method === 'GET' && pathname === '/barbers') {
    return { status: 200, data: await q('SELECT * FROM barbers ORDER BY active DESC, id') };
  }
  if (method === 'GET' && pathname === '/services') {
    return { status: 200, data: await q('SELECT * FROM services ORDER BY active DESC, id') };
  }

  if (method === 'POST' && pathname === '/barbers') {
    const name = ((body || {}).name || '').trim();
    if (!name) return { status: 400, data: { error: 'İsim gerekli' } };
    const r = await run('INSERT INTO barbers(name) VALUES (?)', [name]);
    return { status: 201, data: await one('SELECT * FROM barbers WHERE id = ?', [r.lastId]) };
  }

  if ((m = pathname.match(/^\/barbers\/(\d+)$/)) && method === 'PATCH') {
    const b = body || {};
    if (b.name !== undefined) {
      if (!String(b.name).trim()) return { status: 400, data: { error: 'İsim boş olamaz' } };
      await run('UPDATE barbers SET name = ? WHERE id = ?', [String(b.name).trim(), m[1]]);
    }
    if (b.active !== undefined) {
      if (!b.active) {
        const cnt = (await one("SELECT COUNT(*) c FROM barbers WHERE active = 1 AND id != ?", [m[1]])).c;
        if (!cnt) return { status: 400, data: { error: 'En az bir berber aktif kalmalı' } };
      }
      await run('UPDATE barbers SET active = ? WHERE id = ?', [b.active ? 1 : 0, m[1]]);
    }
    return { status: 200, data: await one('SELECT * FROM barbers WHERE id = ?', [m[1]]) };
  }

  if (method === 'POST' && pathname === '/services') {
    const b = body || {};
    if (!b.name || !String(b.name).trim() || !Number(b.price_cents) || !Number(b.duration_min)) {
      return { status: 400, data: { error: 'İsim, fiyat ve süre gerekli' } };
    }
    const r = await run('INSERT INTO services(name, price_cents, duration_min) VALUES (?,?,?)',
      [String(b.name).trim(), Number(b.price_cents), Number(b.duration_min)]);
    return { status: 201, data: await one('SELECT * FROM services WHERE id = ?', [r.lastId]) };
  }

  if ((m = pathname.match(/^\/services\/(\d+)$/)) && method === 'PATCH') {
    const b = body || {};
    if (b.name !== undefined) await run('UPDATE services SET name = ? WHERE id = ?', [String(b.name).trim(), m[1]]);
    if (b.price_cents !== undefined) await run('UPDATE services SET price_cents = ? WHERE id = ?', [Number(b.price_cents), m[1]]);
    if (b.duration_min !== undefined) await run('UPDATE services SET duration_min = ? WHERE id = ?', [Number(b.duration_min), m[1]]);
    if (b.active !== undefined) await run('UPDATE services SET active = ? WHERE id = ?', [b.active ? 1 : 0, m[1]]);
    return { status: 200, data: await one('SELECT * FROM services WHERE id = ?', [m[1]]) };
  }

  if (method === 'PATCH' && pathname === '/settings') {
    const b = body || {};
    if (b.no_show_fee_cents !== undefined) {
      const fee = Number(b.no_show_fee_cents);
      if (!(fee >= 0)) return { status: 400, data: { error: 'Geçersiz tutar' } };
      await setSetting('no_show_fee_cents', fee);
    }
    if (b.hours !== undefined) {
      for (let d = 0; d <= 6; d++) {
        const h = b.hours[d];
        if (h !== null && (!Array.isArray(h) || !/^\d{2}:\d{2}$/.test(h[0]) || !/^\d{2}:\d{2}$/.test(h[1]))) {
          return { status: 400, data: { error: 'Geçersiz saat formatı' } };
        }
        if (h !== null && toMin(h[0]) >= toMin(h[1])) {
          return { status: 400, data: { error: 'Açılış saati kapanıştan önce olmalı' } };
        }
      }
      await setSetting('hours', JSON.stringify(b.hours));
    }
    if (b.admin_password !== undefined) {
      const p = String(b.admin_password).trim();
      if (p.length < 6) return { status: 400, data: { error: 'Şifre en az 6 karakter olmalı' } };
      await setSetting('admin_password', p);
    }
    return { status: 200, data: { ok: true } };
  }

  if (method === 'GET' && pathname === '/stats') {
    const t = todayStr();
    return { status: 200, data: {
      today_total: (await one('SELECT COUNT(*) c FROM appointments WHERE date = ?', [t])).c,
      today_left: (await one("SELECT COUNT(*) c FROM appointments WHERE date = ? AND status = 'scheduled'", [t])).c,
      open_penalties: (await one("SELECT COALESCE(SUM(amount_cents),0) t FROM penalties WHERE status = 'open'")).t,
      blacklist_count: (await one('SELECT COUNT(*) c FROM customers WHERE blacklisted = 1')).c,
    } };
  }

  return { status: 404, data: { error: 'not found' } };
}

module.exports = { handle };
