const { cpSync, mkdirSync, rmSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const output = resolve(root, 'public');
rmSync(output, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
mkdirSync(output);
// Explicitly copy public assets: server code, environment files, and tests stay private.
for (const entry of ['index.html', 'styles.css', 'script.js', 'window-layout.js',
  'theme-cursors.css', 'theme-icons.css', 'assets', 'claude']) {
  cpSync(resolve(root, entry), resolve(output, entry), { recursive: true });
}
console.log('Built static website in public/. Vercel deploys api/claude.js separately.');
