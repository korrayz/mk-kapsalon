// Demo verisini bugüne göre yeniden üretir (sadece is_demo kayıtları; gerçek veriye dokunmaz).
// Çalıştır: node admin/seed-demo.js  (TURSO_DATABASE_URL/TURSO_AUTH_TOKEN ayarlıysa Turso'ya yazar)
// Panelden "Demo verisi" anahtarıyla da aynı iş yapılır.
const { ensureReady, seedDemo } = require('./core');

ensureReady()
  .then(seedDemo)
  .then(() => { console.log('Demo verisi yenilendi'); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
