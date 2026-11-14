(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.ChatMarkdown = factory(root.marked, root.DOMPurify, root.katex);
})(globalThis, function (marked, purifier, katex) {
  const parser = marked?.Marked ? new marked.Marked({
    gfm: true,
    breaks: true,
    renderer: { checkbox: ({ checked }) => checked ? '☑ ' : '☐ ' }
  }) : null;

  // Tokenize TeX before Markdown can consume its backslashes, underscores, or stars.
  let formulas = [];
  let marker = '';
  function mathToken(src) {
    const match = /^(\$\$)([\s\S]+?)\$\$/.exec(src) ||
      /^(\\\[)([\s\S]+?)\\\]/.exec(src) ||
      /^(\\\()([^\n]+?)\\\)/.exec(src) ||
      /^(\$)(?!\s)([^$\n]*?\S)\$(?!\d)/.exec(src);
    if (!match) return;
    return {type: 'math', raw: match[0], tex: match[2], display: ['$$', '\\['].includes(match[1])};
  }
  function mathPlaceholder(token) {
    const index = formulas.push(token) - 1;
    return `<code>${marker}${index}</code>`;
  }
  if (parser) parser.use({extensions: [{
    name: 'displayMath', level: 'block',
    start: src => src.search(/(?:^|\n)(?:\$\$|\\\[)/),
    tokenizer(src) {
      const token = mathToken(src);
      if (token?.display) return {...token, type: 'displayMath'};
    },
    renderer: mathPlaceholder
  }, {
    name: 'math', level: 'inline',
    start: src => src.search(/\$|\\[([]/),
    tokenizer: mathToken,
    renderer: mathPlaceholder
  }]});

  function render(element, content) {
    formulas = [];
    marker = `math-${Math.random().toString(36).slice(2)}-`;
    element.replaceChildren();
    element.classList.remove('markdown-body');
    try {
      if (!parser || !purifier?.sanitize) throw new Error('Renderer unavailable');
      const fragment = purifier.sanitize(parser.parse(content), {
        RETURN_DOM_FRAGMENT: true,
        ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'del', 's',
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
          'pre', 'code', 'hr', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
        ALLOWED_ATTR: ['href', 'title', 'start', 'align'],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false
      });
      for (const link of fragment.querySelectorAll('a')) {
        const href = link.getAttribute('href');
        try {
          if (!href || !['https:', 'http:', 'mailto:'].includes(new URL(href, element.ownerDocument.baseURI).protocol)) throw new Error('Unsupported link');
          link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener noreferrer');
        } catch { link.removeAttribute('href'); }
      }
      for (const table of fragment.querySelectorAll('table')) {
        const wrapper = element.ownerDocument.createElement('div');
        wrapper.className = 'markdown-table';
        wrapper.tabIndex = 0;
        wrapper.setAttribute('role', 'region');
        wrapper.setAttribute('aria-label', 'Table; scroll horizontally if needed');
        table.before(wrapper);
        wrapper.append(table);
      }
      element.classList.add('markdown-body');
      element.append(fragment);
      for (const placeholder of element.querySelectorAll('code')) {
        if (placeholder.closest('pre') || !placeholder.textContent.startsWith(marker)) continue;
        const token = formulas[Number(placeholder.textContent.slice(marker.length))];
        if (!token) continue;
        const math = element.ownerDocument.createElement('span');
        math.className = token.display ? 'math-display' : 'math-inline';
        try {
          if (!katex?.renderToString) throw new Error('Math renderer unavailable');
          // Native MathML needs no inline styles, remote fonts, or relaxed CSP.
          math.innerHTML = katex.renderToString(token.tex, {
            output: 'mathml', displayMode: token.display, throwOnError: true,
            trust: false, strict: 'ignore', maxExpand: 200, maxSize: 10, macros: {}
          });
        } catch { math.textContent = token.raw; }
        placeholder.replaceWith(math);
      }
    } catch {
      // A failed library load must never turn untrusted content into raw HTML.
      element.textContent = content;
    }
  }

  return { render };
});
