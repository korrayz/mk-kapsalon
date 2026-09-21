// Vercel serverless: tüm /api/* istekleri admin/core.js router'ına gider.
const { handle } = require('../admin/core');

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const body = typeof req.body === 'object' ? req.body : null;
    const r = await handle(req.method, url.pathname.replace(/^\/api/, ''), url.searchParams, body, token);
    res.status(r.status).json(r.data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
};
