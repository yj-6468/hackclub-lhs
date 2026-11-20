const { createHash } = require('node:crypto');

const metrics = ['requests', 'inputTokens', 'outputTokens'];
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const memberKey = id => createHash('sha256').update(id).digest('hex');
const fields = id => metrics.map(metric => memberKey(id) + ':' + metric);
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

function createUsageStore(env, fetchImpl = fetch) {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
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
    async record(id, totals, timestamp) {
      const dayKey = key + ':day:' + usageDay(timestamp);
      const commands = [['HSETNX', key, 'since', timestamp]];
      for (const bucket of [key, dayKey]) {
        fields(id).forEach((field, index) => commands.push(['HINCRBY', bucket, field, totals[metrics[index]]]));
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
            outputTokens: count(Number(result[offset + 2]))
          };
        })
      };
    }
  };
}

module.exports = { createUsageStore, addClaudeUsage, usageDay };
