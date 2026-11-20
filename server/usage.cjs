const { createHash, randomUUID } = require('node:crypto');

const metrics = ['requests', 'inputTokens', 'outputTokens', 'costNanos', 'pricedRequests'];
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const memberKey = id => createHash('sha256').update(id).digest('hex');
const fields = id => metrics.map(metric => memberKey(id) + ':' + metric);
const CHAT_TTL_SECONDS = 14 * 24 * 60 * 60;
const CHAT_PAGE_SIZE = 20;
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
function usageDay(timestamp) {
  const parts = Object.fromEntries(dayFormat.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

function addClaudeUsage(totals, usage) {
  totals.inputTokens += count(usage?.input_tokens) +
    count(usage?.cache_creation_input_tokens) + count(usage?.cache_read_input_tokens);
  totals.outputTokens += count(usage?.output_tokens);
}

// Standard Claude API prices, expressed as integer USD nanodollars per token.
// https://platform.claude.com/docs/en/about-claude/pricing
const rates = new Map([
  ['claude-sonnet-5-5', [2000, 10000, 100]],
  ['claude-sonnet-5', [2000, 10000, 200]],
  ['claude-sonnet-4-6', [3000, 15000, 300]],
  ['claude-sonnet-4-5', [3000, 15000, 300]],
  ['claude-opus-5-5', [4000, 20000, 200]]
]);

function estimateCostNanos(model, usage) {
  if (!Number.isSafeInteger(usage?.input_tokens) || !Number.isSafeInteger(usage?.output_tokens)) return null;
  const input = count(usage.input_tokens);
  const cacheRead = count(usage.cache_read_input_tokens);
  const cacheWrite = count(usage.cache_creation_input_tokens);
  const hourWrites = Math.min(cacheWrite, count(usage.cache_creation?.ephemeral_1h_input_tokens));
  const modelRates = model === 'claude-haiku-5-5'
    ? input + cacheRead + cacheWrite > 100000 ? [500, 2500, 50] : [100, 500, 10]
    : rates.get(model?.replace(/-\d{8}$/, ''));
  if (!modelRates) return null;
  const [inputRate, outputRate, readRate] = modelRates;
  return input * inputRate + count(usage.output_tokens) * outputRate + cacheRead * readRate +
    (cacheWrite - hourWrites) * inputRate * 1.25 + hourWrites * inputRate * 2 +
    count(usage.server_tool_use?.web_search_requests) * 10_000_000;
}

function createUsageStore(env, fetchImpl = fetch) {
  const upstashUrl = env.UPSTASH_REDIS_REST_URL?.trim();
  const upstashToken = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const [url, token] = upstashUrl && upstashToken
    ? [upstashUrl, upstashToken]
    : [env.KV_REST_API_URL?.trim(), env.KV_REST_API_TOKEN?.trim()];
  if (!token || !url) return null;
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.upstash.io') ||
      endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) return null;
  const key = 'hackclub-lhs:usage:v1:' + (env.VERCEL_ENV || 'development');

  async function command(path, body) {
    const response = await fetchImpl(endpoint.origin + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(3500)
    });
    if (!response.ok) throw new Error('Usage store request failed.');
    return response.json();
  }

  async function transact(commands) {
    const result = await command('/multi-exec', commands);
    if (!Array.isArray(result) || result.length !== commands.length ||
        result.some(entry => !entry || !Object.hasOwn(entry, 'result'))) {
      throw new Error('Usage store transaction failed.');
    }
  }

  return {
    async record(id, totals, timestamp, chat) {
      const dayKey = key + ':day:' + usageDay(timestamp);
      const commands = [['HSETNX', key, 'since', timestamp]];
      for (const bucket of [key, dayKey]) {
        fields(id).forEach((field, index) => commands.push(['HINCRBY', bucket, field, totals[metrics[index]]]));
      }
      if (chat) {
        const chatIndex = key + ':chat-index:' + memberKey(id) + ':' + usageDay(timestamp);
        const entryKey = key + ':chat:' + randomUUID();
        commands.push(
          ['SET', entryKey, JSON.stringify({ timestamp, ...chat }), 'EX', CHAT_TTL_SECONDS],
          ['ZADD', chatIndex, Date.parse(timestamp), entryKey],
          ['ZREMRANGEBYSCORE', chatIndex, '-inf', Date.parse(timestamp) - CHAT_TTL_SECONDS * 1000],
          ['EXPIRE', chatIndex, CHAT_TTL_SECONDS]
        );
      }
      await transact(commands);
    },
    async read(ids, date) {
      const bucket = date ? key + ':day:' + date : key;
      const fieldNames = ids.flatMap(fields);
      const { result } = await command('/', ['HMGET', bucket, 'since', ...fieldNames]);
      if (!Array.isArray(result) || result.length !== 1 + fieldNames.length) {
        throw new Error('Usage counters could not be read.');
      }
      return {
        since: result[0],
        users: ids.map((id, index) => {
          const offset = 1 + index * metrics.length;
          return {
            id,
            requests: count(Number(result[offset])),
            inputTokens: count(Number(result[offset + 1])),
            outputTokens: count(Number(result[offset + 2])),
            costNanos: count(Number(result[offset + 3])),
            pricedRequests: count(Number(result[offset + 4]))
          };
        })
      };
    },
    async readChats(id, date, offset) {
      const chatIndex = key + ':chat-index:' + memberKey(id) + ':' + date;
      const { result: keys } = await command('/', ['ZREVRANGE', chatIndex, offset, offset + CHAT_PAGE_SIZE]);
      if (!Array.isArray(keys)) throw new Error('Chat history could not be read.');
      const page = keys.slice(0, CHAT_PAGE_SIZE);
      if (!page.length) return { entries: [], next: null };
      const { result } = await command('/', ['MGET', ...page]);
      if (!Array.isArray(result)) throw new Error('Chat history could not be read.');
      return {
        entries: result.filter(value => typeof value === 'string').map(value => JSON.parse(value)),
        next: keys.length > CHAT_PAGE_SIZE ? offset + CHAT_PAGE_SIZE : null
      };
    }
  };
}

module.exports = { createUsageStore, addClaudeUsage, estimateCostNanos, usageDay };
