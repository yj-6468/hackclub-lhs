const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
// Only these browser distributions are served; never expose the node_modules directory.
module.exports = Object.freeze({
  '/clubhelper/vendor/katex.js': resolve(root, 'node_modules/katex/dist/katex.min.js'),
  '/clubhelper/vendor/marked.js': resolve(root, 'node_modules/marked/lib/marked.umd.js'),
  '/clubhelper/vendor/dompurify.js': resolve(root, 'node_modules/dompurify/dist/purify.min.js')
});
