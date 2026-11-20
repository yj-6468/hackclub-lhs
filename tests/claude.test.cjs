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

async function request(handler, { method = 'POST', url = '/api/clubhelper', body = { messages: question }, headers = {}, chunks } = {}) {
  const req = Readable.from(chunks || []);
  Object.assign(req, {
    method, url,
    headers: { host: 'club.example', 'content-type': 'application/json', authorization: credentials(), ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    ...(chunks ? {} : { body })
  });
  const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(text) { this.body = JSON.parse(text); } };
  await handler(req, res);
  return { status: res.statusCode, headers: res.headers, body: res.body };
}

test('missing configuration fails closed before any paid request', async () => {
  const singleAccount = {
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    CLAUDE_USER_1_ID: env.CLAUDE_USER_1_ID,
    CLAUDE_USER_1_PASSWORD: env.CLAUDE_USER_1_PASSWORD
  };
  for (const config of [{}, { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY },
    { ...singleAccount, CLAUDE_USER_1_PASSWORD: 'short' }, { ...env, ANTHROPIC_API_KEY: '' },
    { ...singleAccount, CLAUDE_USER_1_PASSWORD: '' }, { ...singleAccount, CLAUDE_USER_1_ID: '' },
    { ...env, CLAUDE_USER_2_ID: env.CLAUDE_USER_1_ID },
    { ...singleAccount, CLAUDE_USER_1_ID: 'invalid:id' }]) {
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
  assert.deepEqual(unlocked.body, { ok: true, userId: env.CLAUDE_USER_1_ID, allowedModels: ['sonnet', 'haiku', 'opus'] });
  assert.equal(unlocked.headers['Cache-Control'], 'no-store');
});

test('8-11 character passwords can sign in, while passwords outside 8-128 cannot enable an account', async () => {
  for (const password of ['testpass', 'testpass9', 'testpass10', 'testpass123']) {
    const handler = createHandler({ env: { ...env, CLAUDE_USER_1_PASSWORD: password }, fetchImpl: () => assert.fail('sign-in must not call Claude') });
    const result = await request(handler, { method: 'GET', headers: { authorization: credentials(env.CLAUDE_USER_1_ID, password) } });
    assert.equal(result.status, 200);
    assert.equal(result.body.userId, env.CLAUDE_USER_1_ID);
  }
  for (const password of ['test123', 'x'.repeat(129)]) {
    const handler = createHandler({ env: { ...env, CLAUDE_USER_1_PASSWORD: password }, fetchImpl: () => assert.fail('must not call Claude') });
    assert.equal((await request(handler, { method: 'GET', headers: { authorization: credentials(env.CLAUDE_USER_1_ID, password) } })).status, 401);
    assert.equal((await request(handler, { method: 'GET', headers: { authorization: credentials(env.CLAUDE_USER_2_ID, env.CLAUDE_USER_2_PASSWORD) } })).status, 200);
  }
});

test('all 25 account slots can sign in without returning the account list or passwords', async () => {
  const config = { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY };
  for (let slot = 1; slot <= 25; slot++) {
    config[`CLAUDE_USER_${slot}_ID`] = `member${slot}`;
    config[`CLAUDE_USER_${slot}_PASSWORD`] = `unique-test-password-${slot}`;
  }
  const handler = createHandler({ env: config, fetchImpl: () => assert.fail('sign-in must not call Claude') });
  for (let slot = 1; slot <= 25; slot++) {
    const result = await request(handler, { method: 'GET', headers: { authorization: credentials(`member${slot}`, `unique-test-password-${slot}`) } });
    assert.equal(result.status, 200);
    const allowedModels = [1, 3, 6, 7].includes(slot) ? ['sonnet', 'haiku', 'opus'] : ['sonnet', 'haiku'];
    assert.deepEqual(result.body, { ok: true, userId: `member${slot}`, allowedModels });
  }
  assert.equal((await request(handler, { method: 'GET', headers: { authorization: credentials('member26', 'unique-test-password-26') } })).status, 401);
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
    Array.from({ length: 9 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: 'a'.repeat(index % 2 ? 30000 : 3000) }))]) {
    assert.equal((await request(handler, { body: { messages } })).status, 400);
  }
  assert.equal((await request(handler, { body: '{' })).status, 400);
  assert.equal((await request(handler, { body: 'x'.repeat(4000001) })).status, 413);
  assert.equal((await request(handler, { chunks: ['x'.repeat(2100000), 'x'.repeat(2100000)] })).status, 413);
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
    assert.equal(body.max_tokens, 10240);
    assert.match(body.system, /Hack Club/);
    assert.deepEqual(body.messages, messages);
    assert.ok(!init.body.includes(env.CLAUDE_USER_1_PASSWORD));
    assert.ok(!JSON.stringify(init.headers).includes(env.CLAUDE_USER_1_ID));
    return success();
  } });
  const result = await request(handler, { body: { messages, max_tokens: 999999, system: 'override' }, headers: { origin: 'https://club.example' } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { reply: 'Here is an example.', truncated: false });
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(result).includes(env.ANTHROPIC_API_KEY));
});

test('only the authenticated slots can request Opus and client model IDs are rejected', async () => {
  const config = { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, ANTHROPIC_MODEL: 'claude-opus-5-5' };
  for (let slot = 1; slot <= 25; slot++) {
    // IDs deliberately don't match their slot numbers.
    config[`CLAUDE_USER_${slot}_ID`] = `member${26 - slot}`;
    config[`CLAUDE_USER_${slot}_PASSWORD`] = `test-password-${slot}`;
  }
  const forwardedModels = [];
  const handler = createHandler({ env: config, fetchImpl: async (_, init) => {
    forwardedModels.push(JSON.parse(init.body).model);
    return success();
  } });
  for (let slot = 1; slot <= 25; slot++) {
    const headers = { authorization: credentials(`member${26 - slot}`, `test-password-${slot}`) };
    const result = await request(handler, { headers, body: { messages: question, model: 'opus', slot: 1 } });
    assert.equal(result.status, [1, 3, 6, 7].includes(slot) ? 200 : 403);
  }
  const headers = { authorization: credentials('member24', 'test-password-2') };
  assert.equal((await request(handler, { headers, body: { messages: question, model: 'haiku' } })).status, 200);
  assert.equal((await request(handler, { headers })).status, 200);
  for (const model of ['claude-opus-5-5', 'constructor', ['opus'], null]) {
    assert.equal((await request(handler, { headers, body: { messages: question, model } })).status, 400);
  }
  assert.deepEqual(forwardedModels, [
    ...Array(4).fill('claude-opus-5-5'), 'claude-haiku-5-5', 'claude-sonnet-5-5'
  ]);
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

const png = {media_type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/NsAAAAASUVORK5CYII='};
test('validates images and forwards only canonical image content blocks', async () => {
  let received;
  const handler = createHandler({env, fetchImpl: async (_, init) => { received = JSON.parse(init.body); return success(); }});
  assert.equal((await request(handler, {body: {messages:[{role:'user',content:'Describe',images:[{...png, url:'https://ignored.example'}]}]}})).status,200);
  assert.deepEqual(received.messages[0].content[0], {type:'image',source:{type:'base64',...png}});
  assert.equal(received.tools, undefined);
  const reject = createHandler({env,fetchImpl:()=>assert.fail('Invalid images must not reach provider')});
  for (const images of [[{...png,media_type:'image/svg+xml'}],[{...png,data:'AAAA'}],Array(4).fill(png),[{...png,data:'a'.repeat(700004)}]])
    assert.equal((await request(reject,{body:{messages:[{role:'user',content:'Describe',images}]}})).status,400);
});

test('forwards PDF and image blocks together and rejects invalid PDF payloads before contacting Claude', async () => {
  const pdf = Buffer.from('%PDF-1.7\n%%EOF').toString('base64');
  const user = { role: 'user', content: 'Compare these', images: [png], pdf };
  let calls = 0;
  const handler = createHandler({ env, fetchImpl: async (_, init) => {
    calls++;
    assert.deepEqual(JSON.parse(init.body).messages, [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', ...png } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
      { type: 'text', text: user.content }
    ] }]);
    return success();
  } });
  assert.equal((await request(handler, { body: { messages: [user] } })).status, 200);
  const largePDF = Buffer.alloc(2_000_001);
  largePDF.write('%PDF-');
  for (const invalid of ['http://example.com/test.pdf', 'AAAA', largePDF.toString('base64'), null]) {
    assert.equal((await request(handler, { body: { messages: [{ ...user, pdf: invalid }] } })).status, 400);
  }
  assert.equal((await request(handler, { body: { messages: [user, { role: 'assistant', content: 'Reply', pdf }, user] } })).status, 400);
  assert.equal(calls, 1);
});
test('web tools are bounded, resume paused turns, and return safe source links', async () => {
  let calls = 0;
  const paused = [{type:'server_tool_use',id:'tool1',name:'web_search',input:{query:'example'}}];
  const handler = createHandler({env,fetchImpl:async (_, init)=>{
    const body = JSON.parse(init.body); calls++;
    assert.equal(body.tools.length,2); assert.equal(body.tools[0].max_uses,3);
    if(calls === 1) return Response.json({content:paused,stop_reason:'pause_turn'});
    assert.deepEqual(body.messages.at(-1),{role:'assistant',content:paused});
    return Response.json({content:[{type:'text',text:'An answer.',citations:[{url:'https://example.com',title:'Example'},{url:'javascript:alert(1)',title:'unsafe'}]}],stop_reason:'end_turn'});
  }});
  const result = await request(handler,{body:{messages:question,web:true}});
  assert.equal(result.status,200); assert.equal(calls,2);
  assert.deepEqual(result.body.sources,[{url:'https://example.com',title:'Example'}]);
});
test('web errors are surfaced without exposing raw provider details',async()=>{
  const handler=createHandler({env,fetchImpl:async()=>Response.json({content:[{type:'web_search_tool_result',content:{type:'web_search_tool_result_error',error_code:'unavailable'}},{type:'text',text:'Could not search.'}],stop_reason:'end_turn'})});
  assert.match((await request(handler,{body:{messages:question,web:true}})).body.warning,/could not be accessed/);
});

test('preserves replies five times longer and accepts them in follow-up history', async () => {
  const longReply = 'x'.repeat(80000);
  const handler = createHandler({env,fetchImpl:async()=>Response.json({content:[{type:'text',text:longReply}],stop_reason:'end_turn'})});
  const result=await request(handler);
  assert.equal(result.body.reply,longReply);
  assert.equal(result.body.truncated,false);
  const messages=[...question,{role:'assistant',content:result.body.reply},{role:'user',content:'Continue.'}];
  assert.equal((await request(handler,{body:{messages}})).status,200);
  messages[1].content += 'x';
  assert.equal((await request(handler,{body:{messages}})).status,400);
  const clipped=createHandler({env,fetchImpl:async()=>Response.json({content:[{type:'text',text:longReply+'x'}],stop_reason:'end_turn'})});
  const capped=await request(clipped);
  assert.equal(capped.body.reply.length,80000);
  assert.equal(capped.body.truncated,true);
});

test('misconfigured slots are disabled while unrelated accounts can still sign in', async () => {
  for (const extra of [
    {CLAUDE_USER_25_ID:'member25'},
    {CLAUDE_USER_25_PASSWORD:'test-password-25'},
    {CLAUDE_USER_25_ID:'member25',CLAUDE_USER_25_PASSWORD:'short'},
    {CLAUDE_USER_25_ID:'invalid:id',CLAUDE_USER_25_PASSWORD:'test-password-25'}
  ]) {
    const handler=createHandler({env:{...env,...extra},fetchImpl:()=>assert.fail('No provider call')});
    assert.equal((await request(handler,{method:'GET'})).status,200);
    assert.equal((await request(handler, {method:'GET', headers:{authorization:credentials(extra.CLAUDE_USER_25_ID || 'member25', extra.CLAUDE_USER_25_PASSWORD || '')}})).status,401);
  }
  const handler=createHandler({env:{...env,CLAUDE_USER_25_ID:'member25',CLAUDE_USER_25_PASSWORD:'test-password-25'},fetchImpl:()=>assert.fail('No provider call')});
  assert.equal((await request(handler,{method:'GET',headers:{authorization:credentials('member25','test-password-25')}})).status,200);
  assert.equal((await request(handler,{method:'GET',headers:{authorization:credentials('member25',env.CLAUDE_USER_1_PASSWORD)}})).status,401);
});

test('duplicate IDs cannot log into either slot or change another account’s model access', async () => {
  for (const duplicatePassword of ['test-password-25', '']) {
    const handler = createHandler({
      env: { ...env, CLAUDE_USER_25_ID: env.CLAUDE_USER_1_ID, CLAUDE_USER_25_PASSWORD: duplicatePassword },
      fetchImpl: () => assert.fail('No provider call')
    });
    for (const password of [env.CLAUDE_USER_1_PASSWORD, duplicatePassword]) {
      const result = await request(handler, { method: 'GET', headers: { authorization: credentials(env.CLAUDE_USER_1_ID, password) } });
      assert.equal(result.status, 401);
    }
    const result = await request(handler, { method: 'GET', headers: { authorization: credentials(env.CLAUDE_USER_2_ID, env.CLAUDE_USER_2_PASSWORD) } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.allowedModels, ['sonnet', 'haiku']);
  }
});

test('only admin can read daily usage and chat history, and chat expires without expiring usage', async () => {
  const { createUsageStore } = require('../server/usage.cjs');
  const config = {
    ...env,
    CLAUDE_USER_1_ID: 'admin',
    CLAUDE_USER_3_ID: 'unconfigured-member',
    UPSTASH_REDIS_REST_URL: 'https://test.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'test-redis-token'
  };
  let time = Date.parse('2026-11-19T02:00:00Z');
  const hashes = new Map();
  const records = new Map();
  const indexes = new Map();
  const store = createUsageStore(config, async (url, init) => {
    const commands = JSON.parse(init.body);
    if (url.endsWith('/multi-exec')) {
      assert.doesNotMatch(init.body, /member02|test-password/);
      return Response.json(commands.map(([command, key, field, value, ttl]) => {
        if (command === 'SET') {
          assert.equal(value, 'EX');
          assert.equal(ttl, 14 * 24 * 60 * 60);
          records.set(key, { value: field, expires: time + ttl * 1000 });
          return { result: 'OK' };
        }
        if (command === 'ZADD') {
          indexes.set(key, [value, ...(indexes.get(key) || [])]);
          return { result: 1 };
        }
        if (command === 'ZREMRANGEBYSCORE' || command === 'EXPIRE') return { result: 1 };
        if (!hashes.has(key)) hashes.set(key, new Map());
        const hash = hashes.get(key);
        if (command === 'HSETNX') {
          if (!hash.has(field)) hash.set(field, value);
        } else {
          assert.equal(command, 'HINCRBY');
          assert.doesNotMatch(JSON.stringify([key, field, value]), /How do loops/);
          hash.set(field, String(Number(hash.get(field) || 0) + value));
        }
        return { result: 1 };
      }));
    }
    const [command, key, ...args] = commands;
    if (command === 'MGET') {
      return Response.json({ result: [key, ...args].map(entry => {
        const record = records.get(entry);
        return record?.expires > time ? record.value : null;
      }) });
    }
    if (command === 'ZREVRANGE') return Response.json({ result: (indexes.get(key) || []).slice(args[0], args[1] + 1) });
    assert.equal(command, 'HMGET');
    return Response.json({ result: args.map(field => hashes.get(key)?.get(field) ?? null) });
  });
  let providerCalls = 0;
  const handler = createHandler({
    env: config, usageStore: store, now: () => time,
    fetchImpl: async () => Response.json({
      stop_reason: ++providerCalls === 1 ? 'pause_turn' : 'end_turn',
      content: [{ type: 'text', text: 'A reply' }],
      usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 12, cache_creation_input_tokens: 11 }
    })
  });
  const admin = { authorization: credentials('admin', env.CLAUDE_USER_1_PASSWORD) };
  const member = { authorization: credentials(env.CLAUDE_USER_2_ID, env.CLAUDE_USER_2_PASSWORD) };
  const adminGet = url => request(handler, { method: 'GET', url, headers: admin });
  const daily = '/api/clubhelper?view=usage&date=2026-11-18';
  const history = '/api/clubhelper?view=history&date=2026-11-18';
  for (const url of [daily, history, history + '&member=member02']) {
    assert.equal((await request(handler, { method: 'GET', url, headers: { authorization: '' } })).status, 401);
    assert.equal((await request(handler, { method: 'GET', url, headers: member })).status, 403);
  }
  assert.equal((await adminGet('/api/clubhelper')).body.isAdmin, true);
  assert.equal((await request(handler, { headers: member })).status, 200);
  assert.equal(providerCalls, 2);
  const result = await adminGet(daily);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.users, [
    { id: 'admin', requests: 0, inputTokens: 0, outputTokens: 0 },
    { id: env.CLAUDE_USER_2_ID, requests: 1, inputTokens: 66, outputTokens: 6 },
    { id: 'unconfigured-member', requests: 0, inputTokens: 0, outputTokens: 0 }
  ]);
  assert.equal((await adminGet(daily.replace('11-18', '11-19'))).body.users[1].requests, 0);
  assert.equal((await adminGet(daily.replace('11-18', '99-99'))).status, 400);
  const memberHistory = history + '&member=member02';
  assert.equal((await adminGet(memberHistory)).body.entries[0].message, question[0].content);
  time += 14 * 24 * 60 * 60 * 1000;
  assert.deepEqual((await adminGet(memberHistory)).body.entries, []);
  assert.equal((await adminGet(daily)).body.users[1].requests, 1);
  assert.equal((await adminGet('/api/clubhelper?view=usage')).body.users[1].requests, 1);
  const missing = await request(createHandler({ env: config, usageStore: null }), { method: 'GET', url: daily, headers: admin });
  assert.deepEqual(missing.body, { storageConfigured: false, users: [
    { id: 'admin' }, { id: env.CLAUDE_USER_2_ID }, { id: 'unconfigured-member' }
  ] });
});
