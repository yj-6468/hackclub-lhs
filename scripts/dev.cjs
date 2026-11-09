const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve, extname } = require('node:path');
const handler = require('../api/claude.js');
const vendors = require('./vendor.cjs');
const root = resolve(__dirname, '..');
const publicFiles = new Set(['index.html', 'styles.css', 'script.js', 'window-layout.js', 'theme-cursors.css', 'theme-icons.css']);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (['/api/claude', '/api/clubhelper'].includes(url.pathname)) return await handler(req, res);
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    if (url.pathname === '/claude' || url.pathname.startsWith('/claude/')) {
      res.writeHead(308, { Location: url.pathname.replace(/^\/claude/, '/clubhelper') + url.search });
      return res.end();
    }
    if (url.pathname === '/clubhelper') { res.writeHead(308, { Location: '/clubhelper/' + url.search }); return res.end(); }
    if (Object.hasOwn(vendors, url.pathname)) {
      const data = await readFile(vendors[url.pathname]);
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      return res.end(req.method === 'HEAD' ? undefined : data);
    }
    const name = decodeURIComponent(url.pathname).replace(/^\/+/, '').replace(/\/$/, '/index.html') || 'index.html';
    if (name.split('/').some((part) => part.startsWith('.')) || name.includes('\\') ||
      (!publicFiles.has(name) && !name.startsWith('assets/') && !['clubhelper/index.html', 'clubhelper/styles.css', 'clubhelper/chat.js', 'clubhelper/markdown.js'].includes(name))) {
      res.writeHead(404); return res.end('Not found');
    }
    const data = await readFile(resolve(root, name));
    res.writeHead(200, { 'Content-Type': types[extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(Number(process.env.PORT) || 3000, '127.0.0.1', () => {
  console.log(`Local: http://127.0.0.1:${Number(process.env.PORT) || 3000}/clubhelper/`);
});
