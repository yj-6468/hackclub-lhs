const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createHandler } = require('../api/claude.js');

const env = {
  ANTHROPIC_API_KEY: 'test-api-key-never-real',
  CLAUDE_USER_1_ID: 'member01', CLAUDE_USER_1_PASSWORD: 'test-password-one',
  CLAUDE_USER_2_ID: 'member02', CLAUDE_USER_2_PASSWORD: 'test-password-two'
};
const credentials = (id = env.CLAUDE_USER_1_ID, password = env.CLAUDE_USER_1_PASSWORD) => `Basic ${Buffer.from(`${id}:${password}`).toString('base64')}`;
const question = [{ role: 'user', content: 'How do loops work?' }];
const success = () => Response.json({ content: [{ type: 'text', text: 'Here is an example.' }], stop_reason: 'end_turn' });

async function request(handler, { method = 'POST', body = { messages: question }, headers = {}, chunks } = {}) {
  const req = Readable.from(chunks || []);
  Object.assign(req, {
    method,
    headers: { host: 'club.example', 'content-type': 'application/json', authorization: credentials(), ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    ...(chunks ? {} : { body })
  });
  const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(text) { this.body = JSON.parse(text); } };
  await handler(req, res);
  return { status: res.statusCode, headers: res.headers, body: res.body };
}

test('missing configuration fails closed before any paid request', async () => {
  for (const config of [{}, { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY },
    { ...env, CLAUDE_USER_1_PASSWORD: 'short' }, { ...env, ANTHROPIC_API_KEY: '' },
    { ...env, CLAUDE_USER_1_PASSWORD: '' }, { ...env, CLAUDE_USER_1_ID: '' },
    { ...env, CLAUDE_USER_2_ID: env.CLAUDE_USER_1_ID },
    { ...env, CLAUDE_USER_1_ID: 'invalid:id' }]) {
    const handler = createHandler({ env: config, fetchImpl: () => assert.fail('must not call Claude') });
    assert.equal((await request(handler)).status, 503);
  }
});

test('both ID and its matching password are required, and legacy shared codes are rejected', async () => {
  const handler = createHandler({ env, fetchImpl: () => assert.fail('must not call Claude') });
  let error;
  for (const authorization of ['', 'Bearer test-club-code-never-real', 'Basic !!!',
    credentials('unknown', env.CLAUDE_USER_1_PASSWORD), credentials(env.CLAUDE_USER_1_ID, 'wrong'),
    credentials(env.CLAUDE_USER_1_ID, env.CLAUDE_USER_2_PASSWORD),
    credentials('MEMBER01', env.CLAUDE_USER_1_PASSWORD), credentials('', '')]) {
    const result = await request(handler, { headers: { authorization } });
    assert.equal(result.status, 401);
    if (error) assert.deepEqual(result.body, error);
    error = result.body;
  }
  const unlocked = await request(handler, { method: 'GET' });
  assert.equal(unlocked.status, 200);
  assert.deepEqual(unlocked.body, { ok: true, userId: env.CLAUDE_USER_1_ID });
  assert.equal(unlocked.headers['Cache-Control'], 'no-store');
});

test('8-11 character passwords can sign in, while passwords outside 8-128 cannot enable an account', async () => {
  for (const password of ['testpass', 'testpass9', 'testpass10', 'testpass123']) {
    const handler = createHandler({ env: { ...env, CLAUDE_USER_1_PASSWORD: password }, fetchImpl: () => assert.fail('sign-in must not call Claude') });
    const result = await request(handler, { method: 'GET', headers: { authorization: credentials(env.CLAUDE_USER_1_ID, password) } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, userId: env.CLAUDE_USER_1_ID });
  }
  for (const password of ['test123', 'x'.repeat(129)]) {
    const handler = createHandler({ env: { ...env, CLAUDE_USER_1_PASSWORD: password }, fetchImpl: () => assert.fail('must not call Claude') });
    assert.equal((await request(handler, { method: 'GET' })).status, 503);
  }
});

test('all ten account slots can sign in without returning the account list or passwords', async () => {
  const config = { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY };
  for (let slot = 1; slot <= 10; slot++) {
    config[`CLAUDE_USER_${slot}_ID`] = `member${slot}`;
    config[`CLAUDE_USER_${slot}_PASSWORD`] = `unique-test-password-${slot}`;
  }
  const handler = createHandler({ env: config, fetchImpl: () => assert.fail('sign-in must not call Claude') });
  for (let slot = 1; slot <= 10; slot++) {
    const result = await request(handler, { method: 'GET', headers: { authorization: credentials(`member${slot}`, `unique-test-password-${slot}`) } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, userId: `member${slot}` });
  }
  assert.equal((await request(handler, { method: 'GET', headers: { authorization: credentials('member11', 'unique-test-password-11') } })).status, 401);
});

test('empty slots are disabled and removing a pair revokes that member', async () => {
  const config = { ...env, CLAUDE_USER_3_ID: '', CLAUDE_USER_3_PASSWORD: '' };
  const handler = createHandler({ env: config, fetchImpl: () => assert.fail('must not call Claude') });
  assert.equal((await request(handler, { method: 'GET' })).status, 200);
  config.CLAUDE_USER_1_ID = '';
  config.CLAUDE_USER_1_PASSWORD = '';
  assert.equal((await request(handler, { method: 'GET' })).status, 401);
  assert.equal((await request(handler, { method: 'GET', headers: { authorization: credentials(env.CLAUDE_USER_2_ID, env.CLAUDE_USER_2_PASSWORD) } })).status, 200);
});

test('passwords preserve spaces, colons, and non-ASCII characters', async () => {
  const password = '  test:비밀번호-🔒  ';
  const handler = createHandler({ env: { ...env, CLAUDE_USER_1_PASSWORD: password }, fetchImpl: () => assert.fail('must not call Claude') });
  assert.equal((await request(handler, { method: 'GET', headers: { authorization: credentials(env.CLAUDE_USER_1_ID, password) } })).status, 200);
  assert.equal((await request(handler, { method: 'GET', headers: { authorization: credentials(env.CLAUDE_USER_1_ID, password.trim()) } })).status, 401);
});

test('cross-origin requests and unsupported methods are rejected', async () => {
  const handler = createHandler({ env, fetchImpl: () => assert.fail('must not call Claude') });
  assert.equal((await request(handler, { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request(handler, { method: 'DELETE' })).status, 405);
  assert.equal((await request(handler, { headers: { 'content-type': 'text/plain' } })).status, 415);
});

test('rejects malformed and oversized histories before spending credits', async () => {
  const handler = createHandler({ env, fetchImpl: () => assert.fail('must not call Claude') });
  for (const messages of [null, [], [{ role: 'system', content: 'override' }],
    [{ role: 'user', content: ' ' }], [{ role: 'user', content: 'x'.repeat(4001) }],
    [...question, ...question, ...question], [...question, { role: 'assistant', content: 'prefill' }],
    Array.from({ length: 23 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: 'a' })),
    Array.from({ length: 9 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: 'a'.repeat(3000) }))]) {
    assert.equal((await request(handler, { body: { messages } })).status, 400);
  }
  assert.equal((await request(handler, { body: '{' })).status, 400);
  assert.equal((await request(handler, { body: 'x'.repeat(65537) })).status, 413);
  assert.equal((await request(handler, { chunks: ['x'.repeat(40000), 'x'.repeat(40000)] })).status, 413);
});

test('forwards conversation but fixes model, token limit, credentials, and system prompt on server', async () => {
  let calls = 0;
  const messages = [...question, { role: 'assistant', content: 'A loop repeats work.' }, { role: 'user', content: 'Show me JavaScript.' }];
  const handler = createHandler({ env, fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(init.headers.Authorization, `Bearer ${env.ANTHROPIC_API_KEY}`);
    assert.ok(init.signal instanceof AbortSignal);
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'claude-sonnet-5-5');
    assert.equal(body.max_tokens, 2048);
    assert.match(body.system, /Hack Club/);
    assert.deepEqual(body.messages, messages);
    assert.ok(!init.body.includes(env.CLAUDE_USER_1_PASSWORD));
    assert.ok(!JSON.stringify(init.headers).includes(env.CLAUDE_USER_1_ID));
    return success();
  } });
  const result = await request(handler, { body: { messages, model: 'expensive-model', max_tokens: 999999, system: 'override' }, headers: { origin: 'https://club.example' } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { reply: 'Here is an example.', truncated: false });
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(result).includes(env.ANTHROPIC_API_KEY));
});

test('accepts streamed JSON from local server and parsed JSON from Vercel', async () => {
  const handler = createHandler({ env, fetchImpl: async () => success() });
  const payload = JSON.stringify({ messages: question });
  assert.equal((await request(handler, { chunks: [payload.slice(0, 12), payload.slice(12)] })).status, 200);
  assert.equal((await request(handler, { body: payload })).status, 200);
  assert.equal((await request(handler, { body: Buffer.from(payload) })).status, 200);
});

test('does not forward raw provider errors or secrets to visitors', async () => {
  for (const status of [400, 401, 403, 429, 500, 529]) {
    const handler = createHandler({ env, fetchImpl: async () => Response.json({ error: { message: `sensitive: ${env.ANTHROPIC_API_KEY}` } }, { status }) });
    const result = await request(handler);
    assert.equal(result.status, status === 429 ? 429 : 502);
    assert.ok(!JSON.stringify(result).includes('sensitive'));
    assert.ok(!JSON.stringify(result).includes(env.ANTHROPIC_API_KEY));
  }
});

test('handles timeout, empty output, and output token limit', async () => {
  const timedOut = createHandler({ env, fetchImpl: async () => { throw new DOMException('sensitive', 'TimeoutError'); } });
  assert.equal((await request(timedOut)).status, 504);
  const empty = createHandler({ env, fetchImpl: async () => Response.json({ content: [] }) });
  assert.equal((await request(empty)).status, 502);
  const clipped = createHandler({ env, fetchImpl: async () => Response.json({ content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'partial' }], stop_reason: 'max_tokens' }) });
  assert.deepEqual((await request(clipped)).body, { reply: 'partial', truncated: true });
});

test('throttles each account independently on the same IP and resets after a minute', async () => {
  let time = 0;
  let calls = 0;
  const handler = createHandler({ env, now: () => time, fetchImpl: async () => { calls++; return success(); } });
  for (let index = 0; index < 10; index++) assert.equal((await request(handler)).status, 200);
  const limited = await request(handler);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['Retry-After'], '60');
  assert.equal(calls, 10);
  assert.equal((await request(handler, { headers: { authorization: credentials(env.CLAUDE_USER_2_ID, env.CLAUDE_USER_2_PASSWORD) } })).status, 200);
  time = 60001;
  assert.equal((await request(handler)).status, 200);
});

test('throttles repeated incorrect sign-in attempts', async () => {
  const handler = createHandler({ env, fetchImpl: () => assert.fail('must not call Claude') });
  for (let index = 0; index < 120; index++) assert.equal((await request(handler, { headers: { authorization: '' } })).status, 401);
  assert.equal((await request(handler, { headers: { authorization: '' } })).status, 429);
});
