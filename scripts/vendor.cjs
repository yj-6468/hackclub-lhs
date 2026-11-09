const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
// Only these browser distributions are served; never expose the node_modules directory.
module.exports = Object.freeze({
  '/claude/vendor/marked.js': resolve(root, 'node_modules/marked/lib/marked.umd.js'),
  '/claude/vendor/dompurify.js': resolve(root, 'node_modules/dompurify/dist/purify.min.js')
});
