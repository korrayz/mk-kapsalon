// MK Kapsalon — lokal admin sunucusu. Çalıştır: node admin/server.js → http://localhost:4500
// API mantığı core.js'te; aynı çekirdek Vercel'de /api fonksiyonu olarak da çalışır.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { handle } = require('./core');

const PORT = process.env.PORT || 4500;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(e); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : null;
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const r = await handle(req.method, url.pathname.slice(4), url.searchParams, body, token);
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', ...(r.headers || {}) });
      return res.end(JSON.stringify(r.data));
    }
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
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

server.listen(PORT, () => console.log(`MK Admin: http://localhost:${PORT}`));
