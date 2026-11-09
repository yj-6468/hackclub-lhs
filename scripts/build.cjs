const { cpSync, mkdirSync, rmSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const vendors = require('./vendor.cjs');

const root = resolve(__dirname, '..');
const output = resolve(root, 'public');
rmSync(output, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
mkdirSync(output);
// Explicitly copy public assets: server code, environment files, and tests stay private.
for (const entry of ['index.html', 'styles.css', 'script.js', 'window-layout.js',
  'theme-cursors.css', 'theme-icons.css', 'assets', 'claude']) {
  cpSync(resolve(root, entry), resolve(output, entry), { recursive: true });
}
for (const [url, source] of Object.entries(vendors)) {
  const destination = resolve(output, url.slice(1));
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination);
}
console.log('Built static website in public/. Vercel deploys api/claude.js separately.');
