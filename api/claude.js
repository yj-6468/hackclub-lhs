const { loadAccounts, authenticate } = require('../server/accounts.cjs');

const MAX_BODY_BYTES = 65536;
const MAX_HISTORY_CHARS = 24000;
const MAX_MESSAGES = 21;

function validMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES || messages.length % 2 !== 1) return false;
  let total = 0;
  return messages.every((message, index) => {
    if (!message || message.role !== (index % 2 === 0 ? 'user' : 'assistant') ||
      typeof message.content !== 'string' || !message.content.trim() ||
      message.content.length > (message.role === 'user' ? 4000 : 16000)) return false;
    total += message.content.length;
    return total <= MAX_HISTORY_CHARS;
  });
}

async function readBody(req) {
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) throw new Error('too-large');
  if (req.body !== undefined) {
    const raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new Error('too-large');
    return JSON.parse(raw);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY_BYTES) throw new Error('too-large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function createHandler({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  // Best-effort per-instance throttling. Set a hard workspace spend limit in Claude Console.
  const buckets = new Map();
  function allow(key, limit) {
    const time = now();
    for (const [id, bucket] of buckets) if (bucket.until <= time) buckets.delete(id);
    if (!buckets.has(key)) {
      if (buckets.size >= 2000) return false;
      buckets.set(key, { count: 0, until: time + 60000 });
    }
    return ++buckets.get(key).count <= limit;
  }

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return send(405, { error: 'Method not allowed.' });
    }
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        if (origin.host !== req.headers.host || !['https:', 'http:'].includes(origin.protocol)) throw new Error();
      } catch { return send(403, { error: 'Please open the chat on this website.' }); }
    }
    const apiKey = env.ANTHROPIC_API_KEY?.trim();
    const accounts = loadAccounts(env);
    if (!apiKey || !accounts) {
      return send(503, { error: 'Claude is not configured yet. Please contact a club leader.' });
    }
    // Vercel sets x-vercel-forwarded-for; do not trust arbitrary x-forwarded-for values.
    const ip = String((env.VERCEL && req.headers['x-vercel-forwarded-for']) || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    if (!allow(`attempt:${ip}`, 120)) {
      res.setHeader('Retry-After', '60');
      return send(429, { error: 'Too many requests. Please wait a minute.' });
    }
    const userId = authenticate(req.headers.authorization, accounts);
    if (!userId) {
      return send(401, { error: 'Incorrect ID or password. Please try again or ask a club leader.' });
    }
    if (req.method === 'GET') return send(200, { ok: true, userId });
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return send(415, { error: 'Send a JSON request.' });
    }
    let body;
    try { body = await readBody(req); }
    catch (error) { return send(error.message === 'too-large' ? 413 : 400, { error: 'The message is too large or could not be read.' }); }
    if (!validMessages(body?.messages)) return send(400, { error: 'This conversation is too long or invalid. Please start a new chat.' });
    if (!allow(`chat:${userId}`, 10) || !allow('chat:all', 60)) {
      res.setHeader('Retry-After', '60');
      return send(429, { error: 'Chat is busy. Please wait a minute before sending another message.' });
    }
    try {
      const upstream = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'anthropic-version': '2026-10-21'
        },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          model: env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5-5',
          max_tokens: 2048,
          system: 'You are a helpful coding and project-building assistant for Hack Club at Lexington High School. Explain clearly, help members learn, and be honest when unsure. Do not claim to have accessed tools, websites, private club information, or executed code. You have no tools in this chat.',
          messages: body.messages.map(({ role, content }) => ({ role, content }))
        })
      });
      if (!upstream.ok) {
        if (upstream.status === 429) {
          res.setHeader('Retry-After', '60');
          return send(429, { error: 'Claude has reached a usage limit. Please try again later.' });
        }
        return send(502, { error: upstream.status === 401 || upstream.status === 403
          ? 'The Claude connection needs attention. Please contact a club leader.'
          : 'Claude could not answer right now. Please try again later.' });
      }
      const result = await upstream.json();
      const reply = result.content?.filter((block) => block.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n\n');
      if (!reply?.trim()) return send(502, { error: 'Claude returned no text. Please try again.' });
      return send(200, { reply, truncated: result.stop_reason === 'max_tokens' });
    } catch (error) {
      return send(error.name === 'TimeoutError' || error.name === 'AbortError' ? 504 : 502,
        { error: 'Claude took too long or could not be reached. Please try again.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
