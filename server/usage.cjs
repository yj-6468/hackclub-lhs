const { createHash } = require('node:crypto');

const metrics = ['requests', 'inputTokens', 'outputTokens'];
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const fields = id => {
  const key = createHash('sha256').update(id).digest('hex');
  return metrics.map(metric => key + ':' + metric);
};

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

  return {
    async record(id, totals, timestamp) {
      const increments = fields(id).map((field, index) => ['HINCRBY', key, field, totals[metrics[index]]]);
      const result = await command('/multi-exec', [['HSETNX', key, 'since', timestamp], ...increments]);
      if (!Array.isArray(result) || result.length !== 4 || result.some(entry => !entry || !Object.hasOwn(entry, 'result'))) {
        throw new Error('Usage counters could not be updated.');
      }
    },
    async read(ids) {
      const { result } = await command('/', ['HMGET', key, 'since', ...ids.flatMap(fields)]);
      if (!Array.isArray(result) || result.length !== 1 + ids.length * metrics.length) {
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

module.exports = { createUsageStore, addClaudeUsage };
