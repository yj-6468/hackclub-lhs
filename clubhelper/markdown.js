(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.ChatMarkdown = factory(root.marked, root.DOMPurify);
})(globalThis, function (marked, purifier) {
  const parser = marked?.Marked ? new marked.Marked({
    gfm: true,
    breaks: true,
    renderer: { checkbox: ({ checked }) => checked ? '☑ ' : '☐ ' }
  }) : null;

  function render(element, content) {
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
    } catch {
      // A failed library load must never turn untrusted content into raw HTML.
      element.textContent = content;
    }
  }

  return { render };
});
