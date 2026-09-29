/* Shared geometry for pointer movement, keyboard controls, and saved layouts. */
(function (root) {
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  function fit(rect, area) {
    const width = clamp(finite(rect.width, 480), Math.min(280, area.width), area.width);
    const height = clamp(finite(rect.height, 300), Math.min(160, area.height), area.height);
    return { x: clamp(finite(rect.x, area.x), area.x, area.x + area.width - width),
      y: clamp(finite(rect.y, area.y), area.y, area.y + area.height - height), width, height };
  }
  function resize(rect, dx, dy, edge, area) {
    const minWidth = Math.min(280, area.width), minHeight = Math.min(160, area.height);
    let left = rect.x, top = rect.y, right = left + rect.width, bottom = top + rect.height;
    if (edge.includes('e')) right = clamp(right + dx, left + minWidth, area.x + area.width);
    if (edge.includes('s')) bottom = clamp(bottom + dy, top + minHeight, area.y + area.height);
    if (edge.includes('w')) left = clamp(left + dx, area.x, right - minWidth);
    if (edge.includes('n')) top = clamp(top + dy, area.y, bottom - minHeight);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
  function snap(mode, area) {
    if (mode === 'maximized') return { ...area };
    const half = Math.floor((area.width - 12) / 2);
    return mode === 'left' ? { ...area, width: half } : { ...area, x: area.x + half + 12, width: area.width - half - 12 };
  }
  const api = Object.freeze({ fit, resize, snap });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DesktopLayout = api;
})(globalThis);
