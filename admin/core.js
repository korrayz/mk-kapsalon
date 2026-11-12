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
  for (const t of ['customers', 'appointments', 'penalties']) {
    const cols = await q(`PRAGMA table_info(${t})`);
    if (!cols.some((c) => c.name === 'is_demo')) await db().execute(`ALTER TABLE ${t} ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0`);
  }
  // İlk açılışta demo modu açık gelir
  if ((await getSetting('demo_mode')) == null) {
    // Eski seed-demo.js'in işaretsiz kayıtlarını temizle (çift veri olmasın)
    const old = await q(`SELECT id FROM customers WHERE is_demo = 0 AND name IN (${OLD_SEED_NAMES.map(() => '?').join(',')})`, OLD_SEED_NAMES);
    if (old.length) {
      const ids = old.map((r) => r.id).join(',');
      await db().execute(`DELETE FROM penalties WHERE customer_id IN (${ids})`);
      await db().execute(`DELETE FROM appointments WHERE customer_id IN (${ids})`);
      await db().execute(`DELETE FROM customers WHERE id IN (${ids})`);
    }
    await seedDemo();
    await setSetting('demo_mode', '1');
  }
}

// ---------- Demo verisi ----------
const OLD_SEED_NAMES = ['Daan de Vries', 'Sem Bakker', 'Lucas Visser', 'Thomas Jansen', 'Ruben Smit', 'Emre Demir',
  'Mert Aydın', 'Burak Şahin', 'Finn van Dijk', 'Levi Mulder', 'Julian Bos', 'Kaan Yıldız'];
const DEMO_CUSTOMERS = [
  ['Daan de Vries', '06 21436587', 'Daimi müşteri, hep skin fade'], ['Sem Bakker', '06 38547291', ''],
  ['Lucas Visser', '06 45678123', ''], ['Thomas Jansen', '06 52381746', 'Hassas cilt — alkollü ürün yok'],
  ['Ruben Smit', '06 61728394', ''], ['Emre Demir', '06 73641852', 'Oğluyla geliyor (8 yaş)'],
  ['Mert Aydın', '06 84512637', ''], ['Burak Şahin', '06 91827364', ''], ['Finn van Dijk', '06 24681357', ''],
  ['Levi Mulder', '06 35792468', ''], ['Julian Bos', '06 46913578', ''], ['Kaan Yıldız', '06 57824689', 'Sakal hep kısa'],
  ['Noah de Boer', '06 13572468', ''], ['Milan Peters', '06 86420975', ''], ['Yusuf Çelik', '06 29384756', ''],
  ['Jesse Koster', '06 47362819', ''], ['Bram Hendriks', '06 58273641', 'Öğrenci indirimi'],
  ['Ahmet Kaya', '06 69182736', ''], ['Stijn van Leeuwen', '06 71829364', ''], ['Omar El Amrani', '06 82736451', ''],
  ['Tim Dekker', '06 93847562', '65+ indirimi'], ['Hamza Öztürk', '06 14725836', ''], ['Gijs Vermeulen', '06 25836947', ''],
  ['Sven Brouwer', '06 36947158', ''],
  ['Lars de Graaf', '06 53464097', ''],
  ['Ivo Schouten', '06 30246633', ''],
  ['Mehmet Arslan', '06 62992312', ''],
  ['Sander Kuipers', '06 97366946', ''],
  ['Jayden Willems', '06 16480894', ''],
  ['Rayan Bouzid', '06 19722233', ''],
  ['Max Hoekstra', '06 81924865', ''],
  ['Ali Koç', '06 22633920', ''],
  ['Wouter Prins', '06 59081935', ''],
  ['Thijs Postma', '06 88220482', ''],
  ['Cem Doğan', '06 17784483', ''],
  ['Luuk Verhoeven', '06 78106871', ''],
  ['Bilal Haddou', '06 38816302', ''],
  ['Rick van den Berg', '06 15032582', ''],
  ['Mustafa Aksoy', '06 21535642', ''],
  ['Joep Maas', '06 68202938', ''],
  ['Koen Smits', '06 66126116', ''],
  ['Selim Erdem', '06 19375836', ''],
  ['Bas Jacobs', '06 42301241', ''],
  ['Daniël Kok', '06 22175294', ''],
  ['Furkan Güneş', '06 83960310', ''],
  ['Niels de Wit', '06 66978001', ''],
  ['Ilias Benali', '06 17933677', ''],
  ['Pim Vos', '06 85893910', ''],
  ['Oğuz Tekin', '06 26616417', ''],
  ['Mats Groen', '06 39962626', ''],
  ['Hugo Martens', '06 94641177', ''],
  ['Kerem Polat', '06 94212661', ''],
  ['Teun Bosman', '06 88248519', ''],
  ['Anas Mansouri', '06 18302983', ''],
  ['Floris Dijkstra', '06 87457446', ''],
  ['Serkan Yalçın', '06 88590039', ''],
  ['Jens Timmermans', '06 63241552', ''],
  ['Riza Karaca', '06 16655764', ''],
  ['Boaz van Wijk', '06 39673100', ''],
  ['Volkan Aslan', '06 16252221', ''],
];
// Kara listedekiler: gelmeyip cezayı ödemeyenler
const DEMO_BLACKLIST = {
  'Burak Şahin': 'Üst üste 3 kez gelmedi, cezaları ödemedi',
  'Jesse Koster': 'Randevuya gelmedi, telefonu açmıyor',
  'Yusuf Çelik': 'Personele kaba davrandı + açık ceza',
};
// Ödemeyi geciktirenler (açık ceza, henüz kara listede değil)
const DEMO_LATE = ['Milan Peters', 'Stijn van Leeuwen'];

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

async function clearDemo() {
  const custSub = 'SELECT id FROM customers WHERE is_demo = 1';
  const apptSub = `SELECT id FROM appointments WHERE is_demo = 1 OR customer_id IN (${custSub})`;
  await db().batch([
    `DELETE FROM penalties WHERE is_demo = 1 OR customer_id IN (${custSub}) OR appointment_id IN (${apptSub})`,
    `DELETE FROM appointments WHERE is_demo = 1 OR customer_id IN (${custSub})`,
    'DELETE FROM customers WHERE is_demo = 1',
  ], 'write');
}

async function seedDemo() {
  await clearDemo();
  const rnd = mulberry32(20260412);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const today = todayStr();
  const nowMin = nowMinutesNL();
  const hours = JSON.parse(await getSetting('hours'));
  const barbers = (await q('SELECT id FROM barbers WHERE active = 1 ORDER BY id')).map((b) => b.id);
  const services = await q('SELECT id, name, duration_min FROM services WHERE active = 1 ORDER BY id');
  const byName = (n) => services.find((s) => s.name === n);
  // Popüler hizmetler daha sık gelsin
  const weighted = [];
  for (const s of services) {
    const w = { 'Heren knippen': 6, 'Knippen + Baard': 4, 'Baard modelleren': 3, 'Tondeuse': 2, 'The Full Service': 2, 'Hot towel scheren': 2, 'Kinderen t/m 12': 2, 'Studenten': 2 }[s.name] || 1;
    for (let i = 0; i < w; i++) weighted.push(s);
  }

  // Müşteriler
  await db().batch(DEMO_CUSTOMERS.map(([name, phone, notes], i) => ({
    sql: "INSERT INTO customers(name, phone, notes, is_demo, created_at, blacklisted, blacklist_reason, blacklisted_at) VALUES (?,?,?,1,?,?,?,?)",
    args: [name, phone, notes, addDays(today, -300 + i * 4) + ' 10:00:00',
      DEMO_BLACKLIST[name] ? 1 : 0, DEMO_BLACKLIST[name] || '', DEMO_BLACKLIST[name] ? new Date(Date.now() - (i % 5 + 2) * 86400000).toISOString() : null],
  })), 'write');
  const custRows = await q('SELECT id, name FROM customers WHERE is_demo = 1');
  const cid = Object.fromEntries(custRows.map((c) => [c.name, c.id]));
  const regulars = DEMO_CUSTOMERS.map((c) => c[0]).filter((n) => !DEMO_BLACKLIST[n]);
  const troubled = [...Object.keys(DEMO_BLACKLIST), ...DEMO_LATE];

  // Randevular: 21 gün geri, 14 gün ileri
  const appts = [];
  for (let off = -21; off <= 14; off++) {
    const date = addDays(today, off);
    const h = hours[new Date(date + 'T00:00:00').getDay()];
    if (!h) continue;
    const open = toMin(h[0]), close = toMin(h[1]);
    const fill = off < 0 ? 0.62 : off === 0 ? 0.75 : Math.max(0.2, 0.62 - off * 0.04); // ileri tarihler seyrekleşir
    for (const barber of barbers) {
      let t = open + pick([0, 0, 15, 30]);
      while (t < close) {
        const svc = pick(weighted);
        if (t + svc.duration_min > close) break;
        if (rnd() < fill) {
          const isPast = off < 0 || (off === 0 && t + svc.duration_min <= nowMin);
          let status = 'scheduled';
          if (isPast) { const r = rnd(); status = r < 0.03 ? 'no_show' : r < 0.07 ? 'cancelled' : 'completed'; }
          else if (rnd() < 0.05) status = 'cancelled';
          appts.push({ date, off, start: toHHMM(t), dur: svc.duration_min, barber, svc: svc.id, status, cust: pick(regulars) });
          t += svc.duration_min + pick([0, 0, 0, 15]);
        } else {
          t += pick([15, 30, 45]);
        }
      }
    }
  }
  // Sorunlu müşteriler: geçmişte birkaç "gelmedi", berber ve saat aynen kalır
  const pastDone = appts.filter((a) => a.off < -1 && a.status === 'completed');
  const usedIdx = new Set();
  troubled.forEach((name) => {
    const count = DEMO_BLACKLIST[name] ? (name === 'Burak Şahin' ? 3 : 2) : 1;
    for (let j = 0; j < count; j++) {
      let i = Math.floor(rnd() * pastDone.length);
      while (usedIdx.has(i)) i = (i + 1) % pastDone.length;
      usedIdx.add(i);
      Object.assign(pastDone[i], { cust: name, status: 'no_show' });
    }
    // Kara listede olmayanlar ayrıca normal randevularda da görünsün
    if (!DEMO_BLACKLIST[name]) {
      const fut = appts.filter((a) => a.off > 0 && a.status === 'scheduled');
      if (fut.length) pick(fut).cust = name;
    }
  });
  // Bugünün bekleyen randevularından biri not'lu olsun
  const todayNext = appts.find((a) => a.off === 0 && a.status === 'scheduled');
  if (todayNext) todayNext.note = 'Telefonla aradı, 5 dk gecikebilir';
  const vz = byName('Vader + Zoon');
  const fut2 = appts.find((a) => a.off >= 1 && a.status === 'scheduled' && vz);
  if (fut2) Object.assign(fut2, { cust: 'Emre Demir', svc: vz.id, note: 'Oğlu da kesilecek' });

  await db().batch(appts.map((a) => ({
    sql: 'INSERT INTO appointments(customer_id, barber_id, service_id, date, start_time, duration_min, status, note, is_demo, created_at) VALUES (?,?,?,?,?,?,?,?,1,?)',
    args: [cid[a.cust], a.barber, a.svc, a.date, a.start, a.dur, a.status, a.note || '', addDays(a.date, -(3 + Math.floor(rnd() * 10))) + ' 12:00:00'],
  })), 'write');

  // Cezalar: kara liste + geciktirenler açık; diğerleri ağırlıklı ödendi, bazıları affedildi
  const fee = Number(await getSetting('no_show_fee_cents')) || 2500;
  const ns = await q("SELECT a.id, a.customer_id, a.date, c.name FROM appointments a JOIN customers c ON c.id = a.customer_id WHERE a.is_demo = 1 AND a.status = 'no_show' ORDER BY a.date");
  await db().batch(ns.map((a, i) => {
    let status = troubled.includes(a.name) ? 'open' : (i % 5 === 3 ? 'waived' : 'paid');
    if (status === 'paid' && a.date >= addDays(today, -2)) status = 'open'; // yeni olanlar henüz ödenmemiş
    return {
      sql: 'INSERT INTO penalties(customer_id, appointment_id, amount_cents, reason, status, created_at, resolved_at, is_demo) VALUES (?,?,?,?,?,?,?,1)',
      args: [a.customer_id, a.id, fee, 'no_show', status, a.date + ' 19:00:00', status === 'open' ? null : addDays(a.date, 2) + 'T14:00:00.000Z'],
    };
  }), 'write');
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
      headers: { 'Cache-Control': 'no-store' },
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
      demo_mode: (await getSetting('demo_mode')) === '1',
    } };
  }

  if (method === 'POST' && pathname === '/demo') {
    const on = !!(body || {}).on;
    if (on) await seedDemo(); else await clearDemo();
    await setSetting('demo_mode', on ? '1' : '0');
    return { status: 200, data: { demo_mode: on } };
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
        await run('INSERT INTO penalties(customer_id, appointment_id, amount_cents, reason, is_demo) VALUES (?,?,?,?,?)', [appt.customer_id, id, fee, 'no_show', appt.is_demo || 0]);
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

module.exports = { handle, seedDemo, clearDemo, ensureReady };
