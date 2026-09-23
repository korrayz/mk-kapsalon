// Vercel serverless: vercel.json tüm /api/* isteklerini buraya yönlendirir (?__path=...).
const { handle } = require('../admin/core');

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const rewritten = url.searchParams.get('__path');
    url.searchParams.delete('__path');
    const pathname = rewritten != null ? '/' + rewritten : url.pathname.replace(/^\/api/, '');
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const body = typeof req.body === 'object' ? req.body : null;
    const r = await handle(req.method, pathname, url.searchParams, body, token);
    for (const [k, v] of Object.entries(r.headers || {})) res.setHeader(k, v);
    res.status(r.status).json(r.data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
};
