const { createHash, timingSafeEqual } = require('node:crypto');

const validId = (id) => /^[A-Za-z0-9_.-]{1,64}$/.test(id);
const digest = (value) => createHash('sha256').update(value).digest();

function loadAccounts(env) {
  const accounts = [];
  const ids = new Set();
  for (let slot = 1; slot <= 10; slot++) {
    const id = env[`CLAUDE_USER_${slot}_ID`]?.trim() || '';
    const password = env[`CLAUDE_USER_${slot}_PASSWORD`] || '';
    // Unused slots can be omitted or left completely empty.
    if (!id && !password) continue;
    if (!validId(id) || password.length < 8 || password.length > 128 || ids.has(id)) return null;
    ids.add(id);
    accounts.push({ id, idDigest: digest(id), passwordDigest: digest(password) });
  }
  return accounts.length ? accounts : null;
}

function authenticate(authorization, accounts) {
  if (typeof authorization !== 'string' || authorization.length > 2048) return null;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(authorization);
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 1) return null;
  const id = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  if (!validId(id) || password.length > 128) return null;
  const idDigest = digest(id);
  const passwordDigest = digest(password);
  let authenticatedId = null;
  // Check every account and both fields; do not reveal which field was wrong.
  for (const account of accounts) {
    const idMatches = timingSafeEqual(idDigest, account.idDigest);
    const passwordMatches = timingSafeEqual(passwordDigest, account.passwordDigest);
    if (idMatches && passwordMatches) authenticatedId = account.id;
  }
  return authenticatedId;
}

module.exports = { loadAccounts, authenticate };
