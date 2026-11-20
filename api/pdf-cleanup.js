const { createHash, timingSafeEqual } = require('node:crypto');
const { createPDFStore } = require('../server/pdf-uploads.cjs');

const digest = value => createHash('sha256').update(value).digest();

module.exports = async function (req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET?.trim();
  if (req.method !== 'GET' || !secret || !timingSafeEqual(
    digest(req.headers.authorization || ''), digest(`Bearer ${secret}`)
  )) {
    res.statusCode = 404;
    return res.end();
  }
  try {
    await createPDFStore(process.env)?.clean(Date.now());
    res.statusCode = 204;
  } catch {
    res.statusCode = 503;
  }
  res.end();
};
