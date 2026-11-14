const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const marked = require('marked');
const createDOMPurify = require('dompurify');
const createRenderer = require('../clubhelper/markdown.js');

function setup() {
  const { window } = new JSDOM('<div class="message-body"></div>', { url: 'https://club.example/clubhelper/' });
  const element = window.document.querySelector('div');
  const renderer = createRenderer(marked, createDOMPurify(window), require('katex'));
  return { element, render: (text) => renderer.render(element, text) };
}

test('formats the screenshot-style headings, bold text, paragraphs, and nested lists', () => {
  const { element, render } = setup();
  render('# Economic Impact\n\nThe **Market Revolution** changed *trade*.\n\n## Northeast\n\n- **Factories:** more production\n  - Urban growth\n- Finance\n\n1. Transport\n2. Commerce\n\n> A useful summary.');
  assert.equal(element.querySelector('h1').textContent, 'Economic Impact');
  assert.equal(element.querySelector('h2').textContent, 'Northeast');
  assert.equal(element.querySelector('p strong').textContent, 'Market Revolution');
  assert.equal(element.querySelector('em').textContent, 'trade');
  assert.equal(element.querySelector('ul ul li').textContent, 'Urban growth');
  assert.equal(element.querySelectorAll('ol li').length, 2);
  assert.match(element.querySelector('blockquote').textContent, /A useful summary/);
});

test('supports tables, task lists, strikethrough, inline code, and literal fenced code', () => {
  const { element, render } = setup();
  render('| Region | Economy |\n| --- | --- |\n| Northeast | **Industry** |\n\n- [x] Done\n- [ ] Next\n\n~~old~~ Use `let x = 1`.\n\n```html\n<script>alert("example")</script>\n```');
  assert.equal(element.querySelector('.markdown-table').getAttribute('tabindex'), '0');
  assert.equal(element.querySelectorAll('th').length, 2);
  assert.equal(element.querySelector('td strong').textContent, 'Industry');
  assert.match(element.querySelector('ul').textContent, /☑ Done/);
  assert.match(element.querySelector('ul').textContent, /☐ Next/);
  assert.equal(element.querySelector('del').textContent, 'old');
  assert.equal(element.querySelector('p code').textContent, 'let x = 1');
  assert.match(element.querySelector('pre code').textContent, /<script>alert\("example"\)<\/script>/);
  assert.equal(element.querySelector('script'), null);
});

test('removes executable markup, remote images, forms, event handlers, CSS, and clobbering attributes', () => {
  const { element, render } = setup();
  render('<script>alert(1)</script><style>body { display:none }</style><iframe src="https://evil.example"></iframe>\n\n<img src="https://evil.example/track" onerror="alert(1)"><svg onload="alert(1)"></svg><form><input name="password"></form>\n\n<strong id="access-form" name="location" onclick="alert(1)" style="color:red" class="primary" data-test="bad">Safe bold</strong>');
  assert.equal(element.querySelector('script,style,iframe,img,svg,form,input'), null);
  assert.equal(element.querySelector('[onclick],[onerror],[onload],[style],[id],[name],[data-test]'), null);
  assert.equal(element.querySelector('strong').textContent, 'Safe bold');
  assert.equal(element.querySelector('strong').attributes.length, 0);
});

test('keeps safe links and rejects javascript, data, and custom protocols', () => {
  const { element, render } = setup();
  render('[Docs](https://example.com/docs) [Email](mailto:hello@example.com)\n\n<a href="javascript:alert(1)">bad</a><a href="jav&#x61;script:alert(1)">encoded</a><a href="data:text/html,bad">data</a><a href="tel:123">phone</a>');
  const links = [...element.querySelectorAll('a')];
  assert.equal(links[0].getAttribute('href'), 'https://example.com/docs');
  assert.equal(links[0].getAttribute('rel'), 'noopener noreferrer');
  assert.equal(links[0].getAttribute('target'), '_blank');
  assert.equal(links[1].getAttribute('href'), 'mailto:hello@example.com');
  for (const link of links.slice(2)) assert.equal(link.hasAttribute('href'), false);
});

test('falls back to literal text if the parser or sanitizer is unavailable or fails', () => {
  for (const [parser, purifier] of [[undefined, undefined], [marked, undefined], [marked, { sanitize() { throw new Error('failed'); } }]]) {
    const { element } = setup();
    const content = '**hello** <img src=x onerror=alert(1)>';
    createRenderer(parser, purifier).render(element, content);
    assert.equal(element.textContent, content);
    assert.equal(element.children.length, 0);
    assert.equal(element.classList.contains('markdown-body'), false);
  }
});

test('renders inline and display TeX before Markdown alters its syntax', () => {
  const {element,render}=setup();
  render(String.raw`Inline \(x_1^2 + \alpha\) and $\frac{a}{b}$.

\[
x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}
\]

$$\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$$

\[
\begin{pmatrix}
1 & 2 \\
-3 & 4
\end{pmatrix}
\]`);
  assert.equal(element.querySelectorAll('math').length,5);
  assert.equal(element.querySelectorAll('.math-display').length,3);
  assert.ok(element.querySelector('mfrac'));
  assert.ok(element.querySelector('msqrt'));
  assert.ok(element.querySelector('mtable'));
  assert.match(element.querySelector('annotation').textContent,/x_1/);
});

test('preserves literal code and currency and falls back for malformed math', () => {
  const {element,render}=setup();
  render('Price $5 and $10. `\\(x^2\\)`\n\n```tex\n$$x^2$$\n```\n\n\\(\\badcommand{x}\\)');
  assert.equal(element.querySelectorAll('math').length,0);
  assert.match(element.textContent,/Price \$5 and \$10/);
  assert.equal(element.querySelector('pre code').textContent,'$$x^2$$\n');
  assert.match(element.textContent,/\\badcommand/);
});

test('math cannot create external images, unsafe links, HTML, or unbounded macros', () => {
  const {element,render}=setup();
  render(String.raw`\(\href{javascript:alert(1)}{click}\) \(\includegraphics{https://evil.example/pixel}\) \(\htmlClass{bad}{x}\) \(\def\a{\a}\a\)`);
  assert.equal(element.querySelector('a,img,script,iframe,.bad'),null);
  assert.match(element.textContent,/\\def/);
});
