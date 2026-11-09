const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const handler = require('../api/claude.js');
const root = resolve(__dirname, '..');
const publicFiles = new Set(['index.html', 'styles.css', 'script.js', 'window-layout.js', 'theme-cursors.css', 'theme-icons.css']);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/claude') return await handler(req, res);
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    if (url.pathname === '/claude') { res.writeHead(308, { Location: '/claude/' }); return res.end(); }
    const name = decodeURIComponent(url.pathname).replace(/^\/+/, '').replace(/\/$/, '/index.html') || 'index.html';
    if (name.split('/').some((part) => part.startsWith('.')) || name.includes('\\') ||
      (!publicFiles.has(name) && !name.startsWith('assets/') && !['claude/index.html', 'claude/styles.css', 'claude/chat.js'].includes(name))) {
      res.writeHead(404); return res.end('Not found');
    }
    const data = await readFile(resolve(root, name));
    res.writeHead(200, { 'Content-Type': types[extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(Number(process.env.PORT) || 3000, '127.0.0.1', () => {
  console.log(`Local: http://127.0.0.1:${Number(process.env.PORT) || 3000}/claude/`);
});
