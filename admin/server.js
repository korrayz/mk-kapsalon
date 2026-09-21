// MK Kapsalon — Admin Panel Server (zero dependency: node:http + node:sqlite)
// Çalıştır: node admin/server.js  →  http://localhost:4500
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 4500;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'kapsalon.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// ---------- Schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS barbers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  blacklisted INTEGER NOT NULL DEFAULT 0,
  blacklist_reason TEXT DEFAULT '',
  blacklisted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  barber_id INTEGER NOT NULL REFERENCES barbers(id),
  service_id INTEGER REFERENCES services(id),
  date TEXT NOT NULL,          -- YYYY-MM-DD
  start_time TEXT NOT NULL,    -- HH:MM
  duration_min INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled|completed|no_show|cancelled
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date, barber_id);
CREATE TABLE IF NOT EXISTS penalties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  appointment_id INTEGER REFERENCES appointments(id),
  amount_cents INTEGER NOT NULL,
  reason TEXT DEFAULT 'no_show',
  status TEXT NOT NULL DEFAULT 'open', -- open|paid|waived
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
`);

// ---------- Seed ----------
function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}
if (!getSetting('no_show_fee_cents')) setSetting('no_show_fee_cents', '2500');
if (!getSetting('admin_password')) setSetting('admin_password', 'mk2026'); // panelden değiştirilebilir
if (!getSetting('hours')) {
  // contact.html'deki saatler: Pzt 12-18, Sal-Cmt 9-18, Paz kapalı (0=Pazar)
  setSetting('hours', JSON.stringify({
    0: null, 1: ['12:00', '18:00'], 2: ['09:00', '18:00'], 3: ['09:00', '18:00'],
    4: ['09:00', '18:00'], 5: ['09:00', '18:00'], 6: ['09:00', '18:00'],
  }));
}
if (db.prepare('SELECT COUNT(*) c FROM barbers').get().c === 0) {
  db.prepare('INSERT INTO barbers(name) VALUES (?)').run('Berber 1');
  db.prepare('INSERT INTO barbers(name) VALUES (?)').run('Berber 2');
}
if (db.prepare('SELECT COUNT(*) c FROM services').get().c === 0) {
  const ins = db.prepare('INSERT INTO services(name, price_cents, duration_min) VALUES (?,?,?)');
  ins.run('Heren knippen', 2500, 30);
  ins.run('Studenten', 2200, 30);
  ins.run('Senioren 65+', 2000, 30);
  ins.run('Tondeuse', 1800, 15);
  ins.run('Baard modelleren', 1750, 20);
  ins.run('Hot towel scheren', 2500, 30);
  ins.run('Snor trimmen', 750, 10);
  ins.run('Nekscheren', 750, 10);
  ins.run('Knippen + Baard', 3500, 45);
  ins.run('Knippen + Scheren', 4000, 60);
  ins.run('Vader + Zoon', 4000, 60);
  ins.run('The Full Service', 4500, 60);
  ins.run('Kinderen t/m 12', 1800, 30);
  ins.run('Wassen + föhnen', 1000, 15);
  ins.run('Wenkbrauwen', 750, 10);
  ins.run('Styling & advies', 1000, 15);
}

// ---------- Helpers ----------
const sessions = new Map(); // token -> created ts
function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(e); } });
  });
}
function toMin(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
function toHHMM(min) { return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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

function hasConflict(barberId, date, startMin, durMin, exceptId) {
  const rows = db.prepare(
    `SELECT id, start_time, duration_min FROM appointments
     WHERE barber_id = ? AND date = ? AND status IN ('scheduled','completed') AND id != ?`
  ).all(barberId, date, exceptId || -1);
  const end = startMin + durMin;
  return rows.some((r) => {
    const s = toMin(r.start_time), e = s + r.duration_min;
    return startMin < e && s < end;
  });
}

function freeSlots(barberId, durMin, fromDate, days, step) {
  const hours = JSON.parse(getSetting('hours'));
  const out = [];
  const now = new Date();
  const nowDate = todayStr();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < days; i++) {
    const date = addDays(fromDate, i);
    const dow = new Date(date + 'T00:00:00').getDay();
    const h = hours[dow];
    if (!h) continue;
    const open = toMin(h[0]), close = toMin(h[1]);
    const appts = db.prepare(
      `SELECT start_time, duration_min FROM appointments
       WHERE barber_id = ? AND date = ? AND status IN ('scheduled','completed')`
    ).all(barberId, date).map((r) => [toMin(r.start_time), toMin(r.start_time) + r.duration_min]);
    const slots = [];
    for (let t = open; t + durMin <= close; t += step) {
      if (date === nowDate && t < nowMin) continue;
      const busy = appts.some(([s, e]) => t < e && s < t + durMin);
      if (!busy) slots.push(toHHMM(t));
    }
    if (slots.length) out.push({ date, dow, slots });
  }
  return out;
}

// ---------- API ----------
const routes = [];
function route(method, pattern, handler) { routes.push({ method, pattern, handler }); }

route('POST', /^\/api\/login$/, async (req, res) => {
  const { password } = await readBody(req);
  if (password !== getSetting('admin_password')) return json(res, 401, { error: 'Hatalı şifre' });
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now());
  json(res, 200, { token });
});

route('GET', /^\/api\/meta$/, (req, res) => {
  json(res, 200, {
    barbers: db.prepare('SELECT * FROM barbers WHERE active = 1 ORDER BY id').all(),
    services: db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY id').all(),
    no_show_fee_cents: Number(getSetting('no_show_fee_cents')),
    hours: JSON.parse(getSetting('hours')),
    today: todayStr(),
  });
});

route('GET', /^\/api\/appointments$/, (req, res, url) => {
  const q = url.searchParams;
  let sql = APPT_SELECT + ' WHERE 1=1';
  const args = [];
  if (q.get('date')) { sql += ' AND a.date = ?'; args.push(q.get('date')); }
  if (q.get('from')) { sql += ' AND a.date >= ?'; args.push(q.get('from')); }
  if (q.get('to')) { sql += ' AND a.date <= ?'; args.push(q.get('to')); }
  if (q.get('barber_id')) { sql += ' AND a.barber_id = ?'; args.push(q.get('barber_id')); }
  if (q.get('status')) { sql += ' AND a.status = ?'; args.push(q.get('status')); }
  sql += ' ORDER BY a.date, a.start_time';
  json(res, 200, db.prepare(sql).all(...args));
});

route('POST', /^\/api\/appointments$/, async (req, res) => {
  const b = await readBody(req);
  let customerId = b.customer_id;
  if (!customerId && b.customer_name) {
    const r = db.prepare('INSERT INTO customers(name, phone) VALUES (?,?)').run(b.customer_name.trim(), (b.customer_phone || '').trim());
    customerId = r.lastInsertRowid;
  }
  if (!customerId || !b.barber_id || !b.date || !b.start_time) return json(res, 400, { error: 'Eksik alan' });
  const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!cust) return json(res, 404, { error: 'Müşteri bulunamadı' });
  if (cust.blacklisted && !b.force) {
    return json(res, 409, { blacklisted: true, error: `"${cust.name}" kara listede: ${cust.blacklist_reason || 'sebep girilmemiş'}` });
  }
  let dur = Number(b.duration_min) || 0;
  if (!dur && b.service_id) dur = db.prepare('SELECT duration_min FROM services WHERE id = ?').get(b.service_id)?.duration_min || 30;
  if (!dur) dur = 30;
  if (hasConflict(b.barber_id, b.date, toMin(b.start_time), dur) && !b.force_overlap) {
    return json(res, 409, { conflict: true, error: 'Bu saatte berberin başka randevusu var' });
  }
  const r = db.prepare(
    'INSERT INTO appointments(customer_id, barber_id, service_id, date, start_time, duration_min, note) VALUES (?,?,?,?,?,?,?)'
  ).run(customerId, b.barber_id, b.service_id || null, b.date, b.start_time, dur, b.note || '');
  json(res, 201, db.prepare(APPT_SELECT + ' WHERE a.id = ?').get(r.lastInsertRowid));
});

route('PATCH', /^\/api\/appointments\/(\d+)$/, async (req, res, url, m) => {
  const id = Number(m[1]);
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!appt) return json(res, 404, { error: 'Randevu yok' });
  const b = await readBody(req);
  if (b.status) {
    const valid = ['scheduled', 'completed', 'no_show', 'cancelled'];
    if (!valid.includes(b.status)) return json(res, 400, { error: 'Geçersiz durum' });
    db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(b.status, id);
    if (b.status === 'no_show' && appt.status !== 'no_show') {
      const fee = Number(getSetting('no_show_fee_cents'));
      db.prepare('INSERT INTO penalties(customer_id, appointment_id, amount_cents, reason) VALUES (?,?,?,?)')
        .run(appt.customer_id, id, fee, 'no_show');
    }
    if (appt.status === 'no_show' && b.status !== 'no_show') {
      db.prepare("DELETE FROM penalties WHERE appointment_id = ? AND status = 'open'").run(id);
    }
  }
  for (const k of ['date', 'start_time', 'duration_min', 'barber_id', 'service_id', 'note']) {
    if (b[k] !== undefined) db.prepare(`UPDATE appointments SET ${k} = ? WHERE id = ?`).run(b[k], id);
  }
  json(res, 200, db.prepare(APPT_SELECT + ' WHERE a.id = ?').get(id));
});

route('DELETE', /^\/api\/appointments\/(\d+)$/, (req, res, url, m) => {
  db.prepare("DELETE FROM penalties WHERE appointment_id = ? AND status = 'open'").run(m[1]);
  db.prepare('DELETE FROM appointments WHERE id = ?').run(m[1]);
  json(res, 200, { ok: true });
});

route('GET', /^\/api\/slots$/, (req, res, url) => {
  const q = url.searchParams;
  const barberId = Number(q.get('barber_id'));
  if (!barberId) return json(res, 400, { error: 'barber_id gerekli' });
  const dur = Number(q.get('duration')) || 30;
  const from = q.get('from') || todayStr();
  const days = Math.min(Number(q.get('days')) || 14, 60);
  const step = Number(q.get('step')) || 15;
  const result = freeSlots(barberId, dur, from, days, step);
  const first = result.length ? { date: result[0].date, time: result[0].slots[0] } : null;
  json(res, 200, { earliest: first, days: result });
});

route('GET', /^\/api\/customers$/, (req, res, url) => {
  const q = (url.searchParams.get('q') || '').trim();
  let sql = `
    SELECT c.*,
      (SELECT COUNT(*) FROM appointments a WHERE a.customer_id = c.id) AS appt_count,
      (SELECT COUNT(*) FROM appointments a WHERE a.customer_id = c.id AND a.status = 'no_show') AS no_show_count,
      (SELECT COALESCE(SUM(p.amount_cents),0) FROM penalties p WHERE p.customer_id = c.id AND p.status = 'open') AS open_penalty_cents
    FROM customers c`;
  const args = [];
  if (q) { sql += ' WHERE c.name LIKE ? OR c.phone LIKE ?'; args.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY c.name LIMIT 200';
  json(res, 200, db.prepare(sql).all(...args));
});

route('POST', /^\/api\/customers$/, async (req, res) => {
  const b = await readBody(req);
  if (!b.name || !b.name.trim()) return json(res, 400, { error: 'İsim gerekli' });
  const r = db.prepare('INSERT INTO customers(name, phone, email, notes) VALUES (?,?,?,?)')
    .run(b.name.trim(), (b.phone || '').trim(), (b.email || '').trim(), b.notes || '');
  json(res, 201, db.prepare('SELECT * FROM customers WHERE id = ?').get(r.lastInsertRowid));
});

route('PATCH', /^\/api\/customers\/(\d+)$/, async (req, res, url, m) => {
  const id = Number(m[1]);
  const b = await readBody(req);
  if (b.blacklisted !== undefined) {
    db.prepare('UPDATE customers SET blacklisted = ?, blacklist_reason = ?, blacklisted_at = ? WHERE id = ?')
      .run(b.blacklisted ? 1 : 0, b.blacklisted ? (b.blacklist_reason || '') : '', b.blacklisted ? new Date().toISOString() : null, id);
  }
  for (const k of ['name', 'phone', 'email', 'notes']) {
    if (b[k] !== undefined) db.prepare(`UPDATE customers SET ${k} = ? WHERE id = ?`).run(b[k], id);
  }
  json(res, 200, db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
});

route('GET', /^\/api\/penalties$/, (req, res, url) => {
  const status = url.searchParams.get('status');
  let sql = `
    SELECT p.*, c.name AS customer_name, c.phone AS customer_phone,
           a.date AS appt_date, a.start_time AS appt_time
    FROM penalties p
    JOIN customers c ON c.id = p.customer_id
    LEFT JOIN appointments a ON a.id = p.appointment_id`;
  const args = [];
  if (status) { sql += ' WHERE p.status = ?'; args.push(status); }
  sql += ' ORDER BY p.created_at DESC LIMIT 300';
  const rows = db.prepare(sql).all(...args);
  const openTotal = db.prepare("SELECT COALESCE(SUM(amount_cents),0) t FROM penalties WHERE status = 'open'").get().t;
  json(res, 200, { rows, open_total_cents: openTotal });
});

route('PATCH', /^\/api\/penalties\/(\d+)$/, async (req, res, url, m) => {
  const b = await readBody(req);
  if (!['open', 'paid', 'waived'].includes(b.status)) return json(res, 400, { error: 'Geçersiz durum' });
  db.prepare('UPDATE penalties SET status = ?, resolved_at = ? WHERE id = ?')
    .run(b.status, b.status === 'open' ? null : new Date().toISOString(), m[1]);
  json(res, 200, { ok: true });
});

route('GET', /^\/api\/stats$/, (req, res) => {
  const t = todayStr();
  json(res, 200, {
    today_total: db.prepare('SELECT COUNT(*) c FROM appointments WHERE date = ?').get(t).c,
    today_left: db.prepare("SELECT COUNT(*) c FROM appointments WHERE date = ? AND status = 'scheduled'").get(t).c,
    open_penalties: db.prepare("SELECT COALESCE(SUM(amount_cents),0) t FROM penalties WHERE status = 'open'").get().t,
    blacklist_count: db.prepare('SELECT COUNT(*) c FROM customers WHERE blacklisted = 1').get().c,
  });
});

// ---------- Server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname !== '/api/login') {
        const token = (req.headers.authorization || '').replace('Bearer ', '');
        if (!sessions.has(token)) return json(res, 401, { error: 'unauthorized' });
      }
      for (const r of routes) {
        const m = url.pathname.match(r.pattern);
        if (m && r.method === req.method) return await r.handler(req, res, url, m);
      }
      return json(res, 404, { error: 'not found' });
    }
    // Static
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    file = path.normalize(file).replace(/^([.\\/])+/, '');
    const full = path.join(PUBLIC_DIR, file);
    if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full)) {
      res.writeHead(404); return res.end('404');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    console.error(e);
    json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`MK Admin: http://localhost:${PORT} (şifre: ${getSetting('admin_password')})`));
