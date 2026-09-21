// Demo verisi: müşteriler + bugüne göre ±1 hafta randevu, ceza ve kara liste örnekleri.
// Çalıştır: node admin/seed-demo.js  (TURSO_DATABASE_URL/TURSO_AUTH_TOKEN ayarlıysa Turso'ya yazar)
// Mevcut müşteri/randevu/ceza kayıtlarını SİLER; berber ve hizmetlere dokunmaz.
const path = require('node:path');
const { createClient } = require('@libsql/client');
const { handle } = require('./core'); // şema + berber/hizmet seed'i için

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:' + path.join(__dirname, 'data', 'kapsalon.db'),
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function day(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return { date: fmt(d), dow: d.getDay() };
}

async function main() {
  // core'un şema/seed'ini tetikle (geçersiz token yeterli, sadece ensureReady çalışsın)
  await handle('GET', '/meta', new URLSearchParams(), null, 'x');

  await db.execute('DELETE FROM penalties');
  await db.execute('DELETE FROM appointments');
  await db.execute('DELETE FROM customers');

  const customers = [
    ['Daan de Vries', '06 21436587'], ['Sem Bakker', '06 38547291'], ['Lucas Visser', '06 45678123'],
    ['Thomas Jansen', '06 52381746'], ['Ruben Smit', '06 61728394'], ['Emre Demir', '06 73641852'],
    ['Mert Aydın', '06 84512637'], ['Burak Şahin', '06 91827364'], ['Finn van Dijk', '06 24681357'],
    ['Levi Mulder', '06 35792468'], ['Julian Bos', '06 46913578'], ['Kaan Yıldız', '06 57824689'],
  ];
  const ids = {};
  for (const [name, phone] of customers) {
    const r = await db.execute({ sql: 'INSERT INTO customers(name, phone) VALUES (?,?)', args: [name, phone] });
    ids[name] = Number(r.lastInsertRowid);
  }

  // Servisler: 1 Heren knippen 30dk, 5 Baard 20dk, 6 Hot towel 30dk, 9 Knippen+Baard 45dk,
  // 12 Full Service 60dk, 13 Kinderen 30dk, 4 Tondeuse 15dk
  const A = []; // [gunOfseti, saat, berber, musteri, servis, sure, durum]
  const S = 'scheduled', C = 'completed', N = 'no_show', X = 'cancelled';

  // Geçen hafta (dolu ama abartısız; Pazar -6 atlanır)
  A.push([-5, '10:00', 1, 'Daan de Vries', 1, 30, C], [-5, '11:30', 1, 'Emre Demir', 9, 45, C],
         [-5, '14:00', 2, 'Sem Bakker', 5, 20, C], [-5, '16:30', 2, 'Finn van Dijk', 1, 30, N],
         [-4, '09:30', 1, 'Lucas Visser', 12, 60, C], [-4, '13:00', 1, 'Mert Aydın', 1, 30, C],
         [-4, '15:00', 2, 'Julian Bos', 6, 30, C],
         [-3, '10:15', 1, 'Thomas Jansen', 1, 30, C], [-3, '11:00', 2, 'Kaan Yıldız', 9, 45, C],
         [-3, '14:30', 1, 'Burak Şahin', 1, 30, N], [-3, '16:00', 2, 'Ruben Smit', 4, 15, C],
         [-2, '09:00', 1, 'Levi Mulder', 1, 30, C], [-2, '12:30', 2, 'Daan de Vries', 5, 20, C],
         [-2, '15:30', 1, 'Emre Demir', 1, 30, X],
         [-1, '10:00', 2, 'Sem Bakker', 1, 30, C], [-1, '13:30', 1, 'Finn van Dijk', 9, 45, C],
         [-1, '16:15', 2, 'Thomas Jansen', 5, 20, C]);

  // Bugün: sabah tamamlanmış, öğleden sonra bekleyen
  A.push([0, '12:30', 1, 'Lucas Visser', 1, 30, C], [0, '13:15', 2, 'Mert Aydın', 5, 20, C],
         [0, '15:00', 1, 'Julian Bos', 9, 45, S], [0, '16:30', 2, 'Kaan Yıldız', 1, 30, S],
         [0, '17:15', 1, 'Ruben Smit', 4, 15, S]);

  // Önümüzdeki hafta (Pazar +6 boş kalır)
  A.push([1, '09:30', 1, 'Daan de Vries', 1, 30, S], [1, '11:00', 2, 'Emre Demir', 6, 30, S],
         [1, '14:00', 1, 'Levi Mulder', 5, 20, S], [1, '16:00', 2, 'Sem Bakker', 12, 60, S],
         [2, '10:00', 1, 'Thomas Jansen', 9, 45, S], [2, '13:30', 2, 'Finn van Dijk', 1, 30, S],
         [2, '15:45', 1, 'Kaan Yıldız', 1, 30, S],
         [3, '09:15', 2, 'Julian Bos', 1, 30, S], [3, '12:00', 1, 'Mert Aydın', 12, 60, S],
         [3, '16:30', 2, 'Ruben Smit', 5, 20, S],
         [4, '10:30', 1, 'Lucas Visser', 1, 30, S], [4, '14:15', 2, 'Levi Mulder', 9, 45, S],
         [5, '11:00', 1, 'Emre Demir', 1, 30, S], [5, '13:00', 2, 'Daan de Vries', 4, 15, S],
         [5, '15:30', 1, 'Sem Bakker', 6, 30, S],
         [7, '12:30', 1, 'Finn van Dijk', 1, 30, S], [7, '14:00', 2, 'Thomas Jansen', 5, 20, S]);

  let noShowIds = [];
  for (const [off, time, barber, cust, svc, dur, status] of A) {
    const { date, dow } = day(off);
    if (dow === 0) continue; // Pazar kapalı
    const r = await db.execute({
      sql: 'INSERT INTO appointments(customer_id, barber_id, service_id, date, start_time, duration_min, status) VALUES (?,?,?,?,?,?,?)',
      args: [ids[cust], barber, svc, date, time, dur, status],
    });
    if (status === 'no_show') noShowIds.push({ apptId: Number(r.lastInsertRowid), custId: ids[cust] });
  }

  // Cezalar: Finn ödedi, Burak'ınki açık
  for (const [i, ns] of noShowIds.entries()) {
    const paid = i === 0;
    await db.execute({
      sql: "INSERT INTO penalties(customer_id, appointment_id, amount_cents, reason, status, resolved_at) VALUES (?,?,2500,'no_show',?,?)",
      args: [ns.custId, ns.apptId, paid ? 'paid' : 'open', paid ? new Date().toISOString() : null],
    });
  }

  // Kara liste: Burak Şahin
  await db.execute({
    sql: "UPDATE customers SET blacklisted = 1, blacklist_reason = ?, blacklisted_at = ? WHERE id = ?",
    args: ['Üst üste randevuya gelmedi, cezayı ödemedi', new Date().toISOString(), ids['Burak Şahin']],
  });

  const c = async (t) => (await db.execute('SELECT COUNT(*) c FROM ' + t)).rows[0][0];
  console.log(`Demo hazır: ${await c('customers')} müşteri, ${await c('appointments')} randevu, ${await c('penalties')} ceza`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
