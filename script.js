const shell = document.querySelector('.os-shell');
const desktop = document.querySelector('.desktop');
const windows = [...document.querySelectorAll('[data-window]')];
const windowByName = new Map(windows.map(win => [win.dataset.window, win]));
const desktopIcons = [...document.querySelectorAll('.desktop-icon')];
const taskButtons = [...document.querySelectorAll('.task-button')];
const taskWindowButtons = taskButtons.filter(button => button.dataset.open);
const themeChoices = [...document.querySelectorAll('[data-theme-choice]')];
const taskbar = document.querySelector('.taskbar');
const normalBounds = new Map();
const returnFocus = new Map();
const modes = new Set(['normal', 'left', 'right', 'maximized']);
const STORAGE_KEY = 'hackclub-os-state';
const DEFAULT_THEME = 'cherry';
const compactLayout = () => window.matchMedia('(max-width: 720px)').matches;
const isVisible = win => win.classList.contains('is-open');
const isRunning = win => isVisible(win) || win.classList.contains('is-minimized');
const appName = win => win.getAttribute('aria-label').replace(/ window$/, '');
let activeName = '', focusOrder = [], desktopSnapshot = [], interaction = null;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch { return {}; }
}
function saveState(patch) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadState(), ...patch })); } catch { /* Storage may be disabled. */ }
}
function saveWindowState(name, patch) {
  const saved = loadState();
  saveState({ windows: { ...saved.windows, [name]: { ...saved.windows?.[name], ...patch } } });
}
function persistWindow(win) {
  saveWindowState(win.dataset.window, { open: isRunning(win), minimized: win.classList.contains('is-minimized'),
    mode: win.dataset.mode || 'normal', bounds: normalBounds.get(win.dataset.window) });
}
function workArea() {
  const rect = desktop.getBoundingClientRect();
  const bottom = Math.min(rect.bottom, taskbar.getBoundingClientRect().top);
  return { x: 12, y: 12, width: Math.max(1, rect.width - 24), height: Math.max(1, bottom - rect.top - 24) };
}
function readBounds(win) {
  return { x: win.offsetLeft, y: win.offsetTop, width: win.offsetWidth, height: win.offsetHeight };
}
function writeBounds(win, rect) {
  win.style.left = `${rect.x}px`; win.style.top = `${rect.y}px`;
  win.style.width = `${rect.width}px`; win.style.height = `${rect.height}px`;
}
function updateDockTop() {
  document.documentElement.style.setProperty('--dock-top', `${taskbar.getBoundingClientRect().top}px`);
}
function clampWindowToDock(win) {
  if (compactLayout() || !isVisible(win)) return;
  const name = win.dataset.window;
  const bounds = DesktopLayout.fit(normalBounds.get(name) || readBounds(win), workArea());
  normalBounds.set(name, bounds);
  writeBounds(win, win.dataset.mode === 'normal' ? bounds : DesktopLayout.snap(win.dataset.mode, workArea()));
}
function announce(text) { document.querySelector('#desktop-status').textContent = text; }
function updateWindowControls(win) {
  const button = win.querySelector('[data-maximize]');
  const expanded = win.dataset.mode !== 'normal';
  button.setAttribute('aria-label', `${expanded ? 'Restore' : 'Maximize'} ${appName(win)}`);
  button.setAttribute('aria-pressed', String(expanded));
  button.title = expanded ? 'Restore window size' : 'Maximize window';
  button.disabled = compactLayout();
}
function syncDesktop() {
  taskWindowButtons.forEach(button => {
    const win = windowByName.get(button.dataset.open);
    const focused = isVisible(win) && win.dataset.window === activeName;
    button.classList.toggle('is-running', isRunning(win));
    button.classList.toggle('is-minimized', win.classList.contains('is-minimized'));
    button.classList.toggle('is-active', focused);
    button.setAttribute('aria-pressed', String(focused));
    button.setAttribute('aria-controls', win.id);
    const name = button.querySelector('.dock-label').textContent;
    button.title = `${name} — ${focused ? 'click to minimize' : isRunning(win) ? 'click to restore' : 'click to open'}`;
  });
  const list = document.querySelector('#window-list');
  list.replaceChildren();
  windows.filter(isRunning).forEach(win => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'menu-dropdown-item'; button.setAttribute('role', 'menuitem');
    button.dataset.switchWindow = win.dataset.window;
    button.textContent = `${win.dataset.window === activeName ? '● ' : win.classList.contains('is-minimized') ? '− ' : '○ '}${appName(win)}`;
    list.append(button);
  });
  if (!list.children.length) {
    const empty = document.createElement('span'); empty.className = 'menu-empty'; empty.textContent = 'No open windows'; list.append(empty);
  }
  document.querySelectorAll('[data-window-action]').forEach(button => {
    button.disabled = !activeName || (compactLayout() && ['left', 'right', 'maximize'].includes(button.dataset.windowAction));
  });
  document.querySelector('[data-show-desktop]').textContent = desktopSnapshot.length ? 'Restore windows' : 'Show desktop';
}
function setActive(name, focus = false) {
  const win = windowByName.get(name);
  activeName = win && isVisible(win) ? name : '';
  if (activeName) focusOrder = [...focusOrder.filter(id => id !== activeName), activeName];
  // Bounded stacking keeps windows below menus, the dock, and the photo viewer.
  focusOrder.forEach((id, index) => { windowByName.get(id).style.zIndex = String(10 + index); });
  windows.forEach(item => item.classList.toggle('is-active', item.dataset.window === activeName));
  syncDesktop(); saveState({ active: activeName, order: focusOrder });
  if (focus && win) win.querySelector('.window-title').focus({ preventScroll: true });
}
function nextWindow(excluded, focus = true) {
  const next = [...focusOrder].reverse().map(id => windowByName.get(id)).find(win => win !== excluded && isVisible(win));
  setActive(next?.dataset.window || '', focus);
  if (!next && focus) {
    const opener = returnFocus.get(excluded?.dataset.window);
    const fallback = taskWindowButtons.find(button => button.dataset.open === excluded?.dataset.window) || document.querySelector('.start-menu');
    (opener?.isConnected && !opener.closest('.app-window:not(.is-open)') && opener.getClientRects().length ? opener : fallback).focus({ preventScroll: true });
  }
}
function openWindow(name, detail, opener) {
  const win = windowByName.get(name); if (!win) return;
  const wasRunning = isRunning(win);
  if (opener) returnFocus.set(name, opener);
  win.classList.remove('is-minimized'); win.classList.add('is-open');
  clampWindowToDock(win); setActive(name, true); persistWindow(win);
  if (!wasRunning || detail?.galleryView) win.dispatchEvent(new CustomEvent('app-open', { detail }));
  if (compactLayout()) win.scrollIntoView({ behavior: 'auto', block: 'start' });
}
function minimizeWindow(win) {
  if (!win || !isVisible(win)) return;
  win.classList.remove('is-open', 'is-active'); win.classList.add('is-minimized');
  persistWindow(win); nextWindow(win); announce(`${appName(win)} minimized to the dock.`);
}
function closeWindow(win) {
  const focused = activeName === win.dataset.window;
  win.classList.remove('is-open', 'is-active', 'is-minimized');
  desktopSnapshot = desktopSnapshot.filter(name => name !== win.dataset.window);
  persistWindow(win);
  if (focused) nextWindow(win); else syncDesktop();
  announce(`${appName(win)} closed.`);
}
function setWindowMode(win, mode) {
  if (compactLayout() || !win) return;
  if (win.dataset.mode === 'normal') normalBounds.set(win.dataset.window, DesktopLayout.fit(readBounds(win), workArea()));
  win.dataset.mode = mode; win.classList.toggle('is-maximized', mode === 'maximized');
  clampWindowToDock(win); updateWindowControls(win); setActive(win.dataset.window); persistWindow(win);
}
function toggleMaximize(win) { setWindowMode(win, win.dataset.mode === 'normal' ? 'maximized' : 'normal'); }
function selectDesktopIcon(icon) {
  desktopIcons.forEach(item => item.classList.toggle('is-selected', item === icon));
}
function activateIcon(icon) {
  if (icon.dataset.open) openWindow(icon.dataset.open, { galleryView: icon.dataset.galleryView }, icon);
  else window.open(icon.dataset.external, '_blank', 'noopener,noreferrer');
}
// Mouse double-click mirrors a desktop; touch and native keyboard button clicks open directly.
desktopIcons.forEach(icon => {
  icon.title = 'Double-click to open · tap on touch screens';
  icon.addEventListener('click', event => {
    selectDesktopIcon(icon);
    if (event.detail === 0 || event.pointerType === 'touch' || event.pointerType === 'pen' || compactLayout()) activateIcon(icon);
  });
  icon.addEventListener('dblclick', event => { if (!compactLayout() && event.pointerType !== 'touch') activateIcon(icon); });
});

document.querySelectorAll('[data-open]:not(.desktop-icon):not(.task-button)').forEach(opener => {
  opener.addEventListener('click', () => openWindow(opener.dataset.open, { galleryView: opener.dataset.galleryView }, opener));
});
taskWindowButtons.forEach(button => button.addEventListener('click', () => {
  const win = windowByName.get(button.dataset.open);
  if (activeName === win.dataset.window && isVisible(win)) minimizeWindow(win);
  else openWindow(win.dataset.window, undefined, button);
}));
taskButtons.filter(button => button.dataset.external).forEach(button => button.addEventListener('click', () => {
  window.open(button.dataset.external, '_blank', 'noopener,noreferrer');
}));
function clampDockLabel(button) {
  const label = button.querySelector('.dock-label'); label.style.setProperty('--dock-shift', '0px');
  const rect = button.getBoundingClientRect(), center = rect.left + rect.width / 2, half = label.offsetWidth / 2;
  const shift = center + half > innerWidth - 8 ? innerWidth - 8 - center - half : center - half < 8 ? 8 - center + half : 0;
  label.style.setProperty('--dock-shift', `${shift}px`);
}
taskButtons.forEach((button, index) => {
  button.addEventListener('pointerenter', () => { button.classList.add('is-hovered'); clampDockLabel(button); });
  button.addEventListener('focus', () => clampDockLabel(button));
  button.addEventListener('pointerleave', () => button.classList.remove('is-hovered'));
  button.addEventListener('blur', () => button.classList.remove('is-hovered'));
  button.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % taskButtons.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + taskButtons.length) % taskButtons.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = taskButtons.length - 1;
    if (next !== undefined) { event.preventDefault(); taskButtons[next].focus(); }
  });
});

const snapPreview = document.querySelector('#snap-preview');
function snapTarget(event) {
  const rect = desktop.getBoundingClientRect(), area = workArea();
  if (event.clientY <= rect.top + 22) return 'maximized';
  if (event.clientY > rect.top + area.y + area.height) return null;
  if (event.clientX <= rect.left + 24) return 'left';
  if (event.clientX >= rect.right - 24) return 'right';
  return null;
}
function showSnap(mode) {
  snapPreview.hidden = !mode;
  if (mode) { writeBounds(snapPreview, DesktopLayout.snap(mode, workArea())); snapPreview.textContent = mode === 'maximized' ? 'Maximize' : `Tile ${mode}`; }
}
function beginInteraction(event, win, edge) {
  if (event.button !== 0 || compactLayout() || interaction) return;
  if (!edge && event.target.closest('button')) return;
  event.preventDefault();
  setActive(win.dataset.window);
  const target = event.currentTarget;
  (edge === 'se' ? target : win.querySelector('.window-title')).focus({ preventScroll: true });
  interaction = { win, target, pointerId: event.pointerId, edge, startX: event.clientX, startY: event.clientY,
    origin: readBounds(win), originalMode: win.dataset.mode, originalNormal: { ...normalBounds.get(win.dataset.window) }, moved: false, snap: null };
  target.setPointerCapture(event.pointerId);
}
function moveInteraction(event) {
  const drag = interaction;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  if (!drag.moved) {
    drag.moved = true;
    drag.win.classList.add(drag.edge ? 'is-resizing' : 'is-dragging');
    shell.classList.add('is-grabbing');
    if (drag.originalMode !== 'normal') {
      drag.win.dataset.mode = 'normal'; drag.win.classList.remove('is-maximized');
      if (!drag.edge) {
        const restored = DesktopLayout.fit(drag.originalNormal, workArea());
        const ratio = Math.max(0, Math.min(1, (drag.startX - desktop.getBoundingClientRect().left - drag.origin.x) / drag.origin.width));
        drag.origin = { ...restored, x: drag.startX - desktop.getBoundingClientRect().left - restored.width * ratio,
          y: drag.startY - desktop.getBoundingClientRect().top - 20 };
      }
    }
  }
  const rect = drag.edge ? DesktopLayout.resize(drag.origin, dx, dy, drag.edge, workArea())
    : DesktopLayout.fit({ ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy }, workArea());
  writeBounds(drag.win, rect);
  if (!drag.edge) { drag.snap = snapTarget(event); showSnap(drag.snap); }
}
function endInteraction(cancel = false) {
  const drag = interaction; if (!drag) return;
  interaction = null;
  if (drag.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
  drag.win.classList.remove('is-dragging', 'is-resizing'); shell.classList.remove('is-grabbing'); showSnap(null);
  if (!drag.moved) return;
  if (cancel) {
    normalBounds.set(drag.win.dataset.window, drag.originalNormal); drag.win.dataset.mode = drag.originalMode;
    drag.win.classList.toggle('is-maximized', drag.originalMode === 'maximized'); clampWindowToDock(drag.win);
  } else {
    normalBounds.set(drag.win.dataset.window, readBounds(drag.win));
    if (drag.snap) setWindowMode(drag.win, drag.snap);
  }
  updateWindowControls(drag.win); persistWindow(drag.win);
}
window.addEventListener('pointermove', moveInteraction);
window.addEventListener('pointerup', event => { if (interaction?.pointerId === event.pointerId) endInteraction(); });
window.addEventListener('pointercancel', () => endInteraction(true));
window.addEventListener('blur', () => endInteraction(true));

function keyboardGeometry(event, win, resize = false) {
  if (compactLayout() || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  if (win.dataset.mode !== 'normal') setWindowMode(win, 'normal');
  const step = event.altKey ? 1 : 10;
  const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
  const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
  const rect = readBounds(win);
  const next = resize || event.shiftKey ? DesktopLayout.resize(rect, dx, dy, 'se', workArea())
    : DesktopLayout.fit({ ...rect, x: rect.x + dx, y: rect.y + dy }, workArea());
  writeBounds(win, next); normalBounds.set(win.dataset.window, next); persistWindow(win);
}
windows.forEach(win => {
  win.id = `app-${win.dataset.window}`; win.dataset.mode = 'normal'; win.setAttribute('role', 'dialog');
  const titlebar = win.querySelector('.titlebar'), title = titlebar.querySelector(':scope > span');
  title.classList.add('window-title'); title.tabIndex = 0; title.id = `title-${win.dataset.window}`;
  title.setAttribute('aria-describedby', 'window-keyboard-help');
  titlebar.title = 'Drag to move · double-click to maximize · drag to an edge to tile';
  titlebar.addEventListener('pointerdown', event => beginInteraction(event, win));
  titlebar.addEventListener('dblclick', event => { if (!event.target.closest('button')) toggleMaximize(win); });
  title.addEventListener('keydown', event => {
    keyboardGeometry(event, win);
    if (event.key === 'Enter') { event.preventDefault(); toggleMaximize(win); }
  });
  win.addEventListener('pointerdown', event => {
    if (activeName !== win.dataset.window) setActive(win.dataset.window);
    if (!event.target.closest('button,a,input,select,textarea,[tabindex],[contenteditable]')) win.querySelector('.window-title').focus({ preventScroll: true });
  });
  win.addEventListener('focusin', () => { if (activeName !== win.dataset.window) setActive(win.dataset.window); });
  win.querySelector('[data-close]').addEventListener('click', () => closeWindow(win));
  win.querySelector('[data-minimize]').addEventListener('click', () => minimizeWindow(win));
  win.querySelector('[data-maximize]').addEventListener('click', () => toggleMaximize(win));
  ['×', '−', '□'].forEach((symbol, index) => {
    const button = win.querySelectorAll('.titlebar-controls button')[index];
    const mark = document.createElement('span'); mark.textContent = symbol; mark.setAttribute('aria-hidden', 'true'); button.append(mark);
    button.title = button.getAttribute('aria-label');
  });
  for (const edge of ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw']) {
    const handle = document.createElement(edge === 'se' ? 'button' : 'span');
    handle.className = `resize-handle resize-${edge}`; handle.dataset.resize = edge;
    if (edge === 'se') {
      handle.type = 'button'; handle.setAttribute('aria-label', `Resize ${appName(win)} window`);
      handle.title = 'Drag to resize · use arrow keys when focused';
      handle.addEventListener('keydown', event => keyboardGeometry(event, win, true));
    } else handle.setAttribute('aria-hidden', 'true');
    handle.addEventListener('pointerdown', event => beginInteraction(event, win, edge)); win.append(handle);
  }
  updateWindowControls(win);
});

function applyTheme(theme) {
  const selectedTheme = themeChoices.some(choice => choice.dataset.themeChoice === theme) ? theme : DEFAULT_THEME;
  shell.dataset.theme = selectedTheme;
  themeChoices.forEach(choice => {
    const selected = choice.dataset.themeChoice === selectedTheme; choice.classList.toggle('is-selected', selected);
    choice.setAttribute(choice.getAttribute('role') === 'menuitemradio' ? 'aria-checked' : 'aria-pressed', String(selected));
  });
  saveState({ theme: selectedTheme });
}
themeChoices.forEach(choice => choice.addEventListener('click', () => applyTheme(choice.dataset.themeChoice)));
function restoreState() {
  const saved = loadState(); applyTheme(saved.theme || DEFAULT_THEME);
  focusOrder = Array.isArray(saved.order) ? [...new Set(saved.order.filter(name => windowByName.has(name)))] : [];
  windows.forEach(win => {
    const item = saved.windows?.[win.dataset.window];
    if (item && typeof item === 'object') {
      win.classList.toggle('is-open', Boolean(item.open && !item.minimized));
      win.classList.toggle('is-minimized', Boolean(item.open && item.minimized));
      win.dataset.mode = modes.has(item.mode) ? item.mode : 'normal';
      win.classList.toggle('is-maximized', win.dataset.mode === 'maximized');
      if (item.bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(item.bounds[key]))) normalBounds.set(win.dataset.window, item.bounds);
      else if (item.left && item.top) { win.style.left = item.left; win.style.top = item.top; }
    }
    if (!focusOrder.includes(win.dataset.window)) focusOrder.push(win.dataset.window);
    clampWindowToDock(win); updateWindowControls(win);
  });
  const target = windowByName.get(saved.active);
  const initialActive = windows.find(win => isVisible(win) && win.classList.contains('is-active'));
  setActive(target && isVisible(target) ? target.dataset.window : initialActive?.dataset.window || [...focusOrder].reverse().find(name => isVisible(windowByName.get(name))) || '');
}
updateDockTop(); restoreState();
window.addEventListener('resize', () => {
  endInteraction(true); updateDockTop();
  windows.forEach(win => { clampWindowToDock(win); updateWindowControls(win); }); syncDesktop();
});

const clock = document.querySelector('[data-clock]');
function updateClock() {
  clock.textContent = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date());
}
updateClock(); window.setInterval(updateClock, 30000);

const dropdownTriggers = [...document.querySelectorAll('[data-dropdown]')];
function closeDropdowns(except) {
  dropdownTriggers.forEach(trigger => {
    const item = trigger.closest('.menu-item');
    if (item !== except) { item.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false'); }
  });
}
dropdownTriggers.forEach(trigger => {
  trigger.addEventListener('click', event => {
    event.stopPropagation(); const item = trigger.closest('.menu-item'), opening = !item.classList.contains('is-open');
    closeDropdowns(item); item.classList.toggle('is-open', opening); trigger.setAttribute('aria-expanded', String(opening));
    if (opening && event.detail === 0) item.querySelector('.menu-dropdown button:not(:disabled), .menu-dropdown a')?.focus();
  });
  trigger.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click(); trigger.closest('.menu-item').querySelector('.menu-dropdown button:not(:disabled), .menu-dropdown a')?.focus(); } });
});
document.querySelectorAll('.menu-dropdown').forEach(panel => {
  panel.addEventListener('click', event => { if (event.target.closest('button, a')) closeDropdowns(); });
  panel.addEventListener('keydown', event => {
    const choices = [...panel.querySelectorAll('button:not(:disabled), a')];
    const index = choices.indexOf(document.activeElement); let next;
    if (event.key === 'ArrowDown') next = (index + 1) % choices.length;
    if (event.key === 'ArrowUp') next = (index - 1 + choices.length) % choices.length;
    if (event.key === 'Home') next = 0; if (event.key === 'End') next = choices.length - 1;
    if (next !== undefined) { event.preventDefault(); choices[next]?.focus(); }
  });
});
document.addEventListener('click', event => {
  closeDropdowns();
  if (event.target === desktop || event.target.closest('.boot-card')) selectDesktopIcon(null);
});
document.querySelector('#window-list').addEventListener('click', event => {
  const button = event.target.closest('[data-switch-window]');
  if (button) openWindow(button.dataset.switchWindow, undefined, document.querySelector('.start-menu'));
});
document.querySelectorAll('[data-window-action]').forEach(button => button.addEventListener('click', () => {
  const win = windowByName.get(activeName); if (!win) return;
  const action = button.dataset.windowAction;
  if (action === 'minimize') minimizeWindow(win);
  else if (action === 'close') closeWindow(win);
  else { if (action === 'maximize') toggleMaximize(win); else setWindowMode(win, action); win.querySelector('.window-title').focus({ preventScroll: true }); }
}));
document.querySelector('[data-show-desktop]').addEventListener('click', () => {
  if (desktopSnapshot.length) {
    const restore = desktopSnapshot; desktopSnapshot = [];
    restore.forEach(name => { const win = windowByName.get(name); if (isRunning(win)) openWindow(name); });
  } else {
    desktopSnapshot = focusOrder.filter(name => isVisible(windowByName.get(name)));
    desktopSnapshot.forEach(name => { const win = windowByName.get(name); win.classList.remove('is-open', 'is-active'); win.classList.add('is-minimized'); persistWindow(win); });
    setActive(''); document.querySelector('.start-menu').focus();
  }
  syncDesktop();
});
const desktopHelp = document.querySelector('#desktop-help');
document.querySelector('[data-desktop-help]').addEventListener('click', () => desktopHelp.showModal());
document.querySelector('[data-close-help]').addEventListener('click', () => desktopHelp.close());
desktopHelp.addEventListener('close', () => document.querySelector('.start-menu').focus());
document.querySelector('[data-reset-layout]').addEventListener('click', () => {
  saveState({ windows: {}, active: 'welcome', order: [] }); window.location.reload();
});
document.addEventListener('keydown', event => {
  if (desktopHelp.open || document.querySelector('[data-lightbox]:not([hidden])')) return;
  if (event.key === 'Escape') {
    if (interaction) { event.preventDefault(); endInteraction(true); return; }
    const trigger = dropdownTriggers.find(button => button.getAttribute('aria-expanded') === 'true');
    if (trigger) { event.preventDefault(); closeDropdowns(); trigger.focus(); return; }
    const win = event.target.closest('.app-window');
    if (win && !event.target.closest('input,textarea,select,[contenteditable="true"]')) { event.preventDefault(); closeWindow(win); }
  }
  if (event.altKey && event.code === 'Backquote') {
    const running = windows.filter(isRunning); if (!running.length) return;
    event.preventDefault(); const index = running.findIndex(win => win.dataset.window === activeName);
    const next = (index + (event.shiftKey ? -1 : 1) + running.length) % running.length;
    openWindow(running[next].dataset.window);
  }
});

// ---------------- Gallery ----------------
const GALLERY_FILES = {
  "day1Prep": [
    "IMG_6740.jpeg",
    "IMG_6748.jpeg",
    "IMG_9695.JPG",
    "IMG_9696.JPG",
    "IMG_9705.JPG",
    "IMG_9734.JPG",
    "IMG_9833.JPG",
    "IMG_9838.JPG",
    "IMG_9839.JPG",
    "IMG_9840.JPG",
    "IMG_9841.JPG"
  ],
  "day1Event": [
    "0397C8AA-A58A-4AE6-AAFA-0BA6EB68BDCF.jpeg",
    "06D0DBF4-97C4-4314-9E0D-3F14B7FB0DE6.jpeg",
    "0BC3027A-4781-4FE1-838E-9E31B25742E2.jpeg",
    "114049D4-D3AB-4378-87AB-54B1A07BF56D.jpeg",
    "1A7A9BE0-EC9E-4DDD-9A81-99878056366B.jpeg",
    "1D3E51E4-3649-44DC-9347-5778E7EDAC36.jpeg",
    "27DB4842-BFBF-4FE2-86E1-F834BB26A177.jpeg",
    "39296893-CA34-4A00-8B02-ACB534A05CD7.jpeg",
    "3F0FDA1E-42FB-49E9-B562-9F4D330E09AF.jpeg",
    "47481323-D059-4E05-8CF3-1A43EABE8A8D.jpeg",
    "48FC9F43-B2E3-4183-93C3-3F3B8375EC30.jpeg",
    "4980DE24-8AEF-4DD3-94A0-E774FC5B1B5B_1_105_c.jpeg",
    "4B2EA038-FCA0-489E-9E3A-D32F9E4E2459.jpeg",
    "53E3474D-8595-4CC4-8D47-140D94F5613C.jpeg",
    "58420583-AD42-4865-B5E2-809A08CC5BAE.jpeg",
    "5D46F7C8-42D3-478B-9E01-A4B1C111F519.jpeg",
    "6C7511AA-B31D-4A68-BC34-10DC73CB1539.jpeg",
    "6FD49B70-43D5-41CB-9585-2E5274155E83.jpeg",
    "8FF1C103-5626-4893-AB0A-ED517D33F7B8.jpeg",
    "926C3246-92AE-47F3-9388-3DB46957A1F6.jpeg",
    "940F87EB-8724-4D86-BF70-104DDE2D3C18.jpeg",
    "96378923-274B-4444-B273-99ABE1DF049A.jpeg",
    "A885C68C-302E-436E-A161-1BB287E538FF.jpeg",
    "B08AAE92-9367-49E4-9ED1-23E3F1912B5E.jpeg",
    "B0AD5966-46BF-4A4F-BC13-608F002D2503.jpeg",
    "B607E4D0-C86F-4D9C-91AB-1036C4C2C65F.jpeg",
    "C3887872-2C0C-46F0-AC48-390D522CF9E6.jpeg",
    "C662547D-4866-49A5-A501-85381CD0FFBE.jpeg",
    "C6C398D5-0CAB-46F1-8615-3B6CBE5ACD56.jpeg",
    "C740D718-2220-4B52-84B8-83D2B0FEFFCC.jpeg",
    "C8EE2E63-B4B7-46F9-A3AF-A3EF5F2877F5.jpeg",
    "DB13849D-C7C0-4773-A8D5-733E4E9973D3.jpeg",
    "EBE787EA-348D-42E4-AFFA-9FCCAA9DDC93.jpeg",
    "F78F51A9-CA04-4C6F-87C5-4393EB5274E4.jpeg",
    "F9C9EFF0-F122-418E-9EA3-96D6A415BBEE.jpeg",
    "IMG_6751.jpeg",
    "IMG_6752.jpeg",
    "IMG_6753.jpeg",
    "IMG_9712.JPG",
    "IMG_9722.JPG",
    "IMG_9740.JPG",
    "IMG_9749.JPG",
    "IMG_9750.JPG",
    "IMG_9751.JPG",
    "IMG_9754.JPG",
    "IMG_9755.JPG",
    "IMG_9758.JPG",
    "IMG_9760.JPG",
    "IMG_9761.JPG",
    "IMG_9762.JPG",
    "IMG_9763.JPG",
    "IMG_9764.JPG",
    "IMG_9765.JPG",
    "IMG_9767.JPG",
    "IMG_9768.JPG",
    "IMG_9770.JPG",
    "IMG_9771.JPG",
    "IMG_9773.JPG",
    "IMG_9774.JPG",
    "IMG_9775.JPG",
    "IMG_9777.JPG",
    "IMG_9778.JPG",
    "IMG_9779.JPG",
    "IMG_9780.JPG",
    "IMG_9783.JPG",
    "IMG_9784.JPG",
    "IMG_9785.JPG",
    "IMG_9786.JPG",
    "IMG_9787.JPG",
    "IMG_9791.JPG",
    "IMG_9796.JPG",
    "IMG_9834.JPG",
    "IMG_9835.JPG",
    "IMG_9836.JPG",
    "IMG_9837.JPG",
    "IMG_9937.JPG",
    "IMG_9938.JPG",
    "IMG_9948.JPG"
  ],
  "day2Event": [
  "IMG_0969.JPG",
  "IMG_0941.JPG",
  "IMG_0014.JPG",
  "IMG_0996.JPG",
  "1T7A2755.jpg",
  "IMG_1040.JPG",
  "IMG_0175.JPG",
  "IMG_1041.JPG",
  "1T7A2768.jpg",
  "1T7A2740.jpg",
  "IMG_0983.JPG",
  "IMG_0001.JPG",
  "IMG_0940.JPG",
  "IMG_0954.JPG",
  "IMG_0942.JPG",
  "IMG_0956.JPG",
  "IMG_0017.JPG",
  "IMG_0981.JPG",
  "IMG_0995.JPG",
  "1T7A2756.jpg",
  "1T7A2757.jpg",
  "IMG_0994.JPG",
  "IMG_0957.JPG",
  "IMG_0953.JPG",
  "IMG_0990.JPG",
  "IMG_0012.JPG",
  "1T7A2870-1.jpg",
  "IMG_1046.JPG",
  "IMG_1047.JPG",
  "1T7A2746.jpg",
  "1T7A2752.jpg",
  "IMG_0013.JPG",
  "IMG_0991.JPG",
  "IMG_0985.JPG",
  "IMG_0950.JPG",
  "IMG_0944.JPG",
  "IMG_0993.JPG",
  "IMG_0011.JPG",
  "1T7A2803.jpg",
  "IMG_1045.JPG",
  "IMG_1051.JPG",
  "IMG_1050.JPG",
  "IMG_1044.JPG",
  "1T7A2802.jpg",
  "1T7A2745.jpg",
  "IMG_0010.JPG",
  "IMG_0986.JPG",
  "IMG_0945.JPG",
  "IMG_0951.JPG",
  "1T7A2736.jpg",
  "1T7A2681.jpg",
  "1T7A2656.jpg",
  "IMG_1023.JPG",
  "1T7A2694.jpg",
  "IMG_0935.JPG",
  "1T7A2709.jpg",
  "1T7A2641.jpg",
  "IMG_1008.JPG",
  "IMG_1034.JPG",
  "1T7A2669.jpg",
  "1T7A2640.jpg",
  "IMG_1009.JPG",
  "1T7A2720.jpg",
  "1T7A2734.jpg",
  "IMG_0934.JPG",
  "1T7A2718.jpg",
  "1T7A2724.jpg",
  "IMG_1025.JPG",
  "IMG_1019.JPG",
  "1T7A2645.jpg",
  "IMG_1024.JPG",
  "1T7A2679.jpg",
  "1T7A2731.jpg",
  "1T7A2727.jpg",
  "1T7A2733.jpg",
  "IMG_1032.JPG",
  "1T7A2647.jpg",
  "1T7A2652.jpg",
  "IMG_1033.JPG",
  "1T7A2691.jpg",
  "IMG_0042.JPG",
  "1T7A2703.jpg",
  "1T7A2677.jpg",
  "IMG_1002.JPG",
  "IMG_1016.JPG",
  "1T7A2702.jpg",
  "IMG_0041.JPG",
  "1T7A2714.jpg",
  "1T7A2700.jpg",
  "1T7A2728.jpg",
  "IMG_1029.JPG",
  "1T7A2661.jpg",
  "IMG_0040.JPG",
  "IMG_0939.JPG",
  "IMG_0044.JPG",
  "IMG_1004.JPG",
  "1T7A2664.jpg",
  "IMG_1005.JPG",
  "IMG_1011.JPG",
  "1T7A2658.jpg",
  "1T7A2738.jpg",
  "IMG_0045.JPG",
  "1T7A2706.jpg",
  "1T7A2712.jpg",
  "1T7A2699.jpg",
  "IMG_1007.JPG",
  "IMG_1013.JPG",
  "1T7A2666.jpg",
  "1T7A2673.jpg",
  "1T7A2698.jpg",
  "1T7A2713.jpg",
  "1T7A2707.jpg",
  "IMG_0974.JPG",
  "IMG_0960.JPG",
  "1T7A2760.jpg",
  "1T7A2774.jpg",
  "1T7A2748.jpg",
  "IMG_1049.JPG",
  "1T7A2749.jpg",
  "IMG_0008.JPG",
  "IMG_0963.JPG",
  "IMG_0977.JPG",
  "IMG_0022.JPG",
  "IMG_0988.JPG",
  "1T7A2858-1.jpg",
  "1T7A2763.jpg",
  "1T7A2762.jpg",
  "1T7A2776.jpg",
  "IMG_0037.JPG",
  "IMG_0989.JPG",
  "IMG_0976.JPG",
  "IMG_0966.JPG",
  "IMG_0972.JPG",
  "1T7A2772.jpg",
  "1T7A2766.jpg",
  "1T7A2878-1.jpg",
  "1T7A2773.jpg",
  "1T7A2861-1.jpg",
  "IMG_0032.JPG",
  "IMG_0998.JPG",
  "IMG_0973.JPG",
  "IMG_0967.JPG",
  "IMG_0971.JPG",
  "IMG_0965.JPG",
  "IMG_0018.JPG",
  "1T7A2765.jpg",
  "1T7A2638.jpg",
  "1T7A2770.jpg",
  "IMG_0964.JPG",
  "IMG_0970.JPG"
]
};

const GALLERY_SETS = {
  meetings: {
    label: "Meetings",
    caption: "Meetings",
    photos: Array.from({ length: 8 }, (_, i) => ({
      src: `assets/gallery/meetings/meeting-${String(i + 1).padStart(2, "0")}.jpg`,
      alt: `Meeting photo ${i + 1}`,
    })),
  },
  day1: {
    label: "Day 1",
    caption: "LexHack '26 · Day 1",
    photos: [
      ...GALLERY_FILES.day1Prep.map((file) => ({
        src: `assets/gallery/lexhack-26/day-1/prep/${file}`,
        alt: "LexHack '26 Day 1 prep photo",
      })),
      ...GALLERY_FILES.day1Event.map((file) => ({
        src: `assets/gallery/lexhack-26/day-1/event/${file}`,
        alt: "LexHack '26 Day 1 event photo",
      })),
    ],
  },
  day2: {
    label: "Day 2",
    caption: "LexHack '26 · Day 2",
    photos: GALLERY_FILES.day2Event.map((file) => ({
      src: `assets/gallery/lexhack-26/day-2/event/${file}`,
      alt: "LexHack '26 Day 2 event photo",
    })),
  },
};

const galleryWindow = document.querySelector('[data-window="gallery"]');
const lightbox = document.querySelector("[data-lightbox]");

if (galleryWindow) {
  const galleryPanels = {
    albums: galleryWindow.querySelector('[data-gallery-panel="albums"]'),
    lexhack: galleryWindow.querySelector('[data-gallery-panel="lexhack"]'),
    photos: galleryWindow.querySelector('[data-gallery-panel="photos"]'),
  };
  const galleryCrumbs = galleryWindow.querySelector("[data-gallery-crumbs]");
  let currentSetKey = null;
  let lightboxIndex = 0;
  let photoOpener = null;

  function showGalleryPanel(name) {
    Object.entries(galleryPanels).forEach(([key, el]) => {
      if (el) el.hidden = key !== name;
    });
    clampWindowToDock(galleryWindow);
  }

  function setGalleryCrumbs(steps) {
    galleryCrumbs.innerHTML = "";
    steps.forEach((step, index) => {
      const isLast = index === steps.length - 1;
      const crumb = document.createElement("button");
      crumb.type = "button";
      crumb.textContent = step.label;
      if (isLast) {
        crumb.disabled = true;
        crumb.classList.add("is-current");
      } else {
        crumb.addEventListener("click", step.action);
      }
      galleryCrumbs.appendChild(crumb);
      if (!isLast) {
        const sep = document.createElement("span");
        sep.className = "gallery-crumb-sep";
        sep.textContent = "/";
        galleryCrumbs.appendChild(sep);
      }
    });
  }

  function openGalleryAlbums() {
    showGalleryPanel("albums");
    setGalleryCrumbs([{ label: "Gallery", action: openGalleryAlbums }]);
  }

  function openLexhackFolders() {
    showGalleryPanel("lexhack");
    setGalleryCrumbs([
      { label: "Gallery", action: openGalleryAlbums },
      { label: "LexHack '26", action: openLexhackFolders },
    ]);
  }

  function renderGalleryPhotoGrid(setKey) {
    const set = GALLERY_SETS[setKey];
    const grid = galleryPanels.photos;
    grid.innerHTML = "";
    set.photos.forEach((photo, index) => {
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "gallery-thumb";
      const img = document.createElement("img");
      img.src = photo.src;
      img.alt = photo.alt;
      img.loading = "lazy";
      img.addEventListener("error", () => {
        img.style.display = "none";
      });
      thumb.appendChild(img);
      thumb.addEventListener("click", () => openLightbox(setKey, index));
      grid.appendChild(thumb);
    });
  }

  function openGallerySet(setKey) {
    currentSetKey = setKey;
    renderGalleryPhotoGrid(setKey);
    showGalleryPanel("photos");
    const set = GALLERY_SETS[setKey];
    const steps = [{ label: "Gallery", action: openGalleryAlbums }];
    if (setKey === "day1" || setKey === "day2") {
      steps.push({ label: "LexHack '26", action: openLexhackFolders });
    }
    steps.push({ label: set.label, action: () => openGallerySet(setKey) });
    setGalleryCrumbs(steps);
  }

  galleryWindow.querySelectorAll("[data-gallery-album]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.galleryAlbum;
      if (key === "meetings") openGallerySet("meetings");
      else if (key === "lexhack") openLexhackFolders();
    });
  });

  galleryWindow.querySelectorAll("[data-gallery-folder]").forEach((button) => {
    button.addEventListener("click", () => openGallerySet(button.dataset.galleryFolder));
  });

  openGalleryAlbums();
  galleryWindow.addEventListener("app-open", (event) => {
    if (event.detail?.galleryView === "lexhack") openLexhackFolders();
    else openGalleryAlbums();
  });

  // ---- lightbox ----
  const lightboxImg = lightbox?.querySelector("[data-lightbox-img]");
  const lightboxCaption = lightbox?.querySelector("[data-lightbox-caption]");

  function updateLightbox() {
    const set = GALLERY_SETS[currentSetKey];
    const photo = set.photos[lightboxIndex];
    lightboxImg.src = photo.src;
    lightboxImg.alt = photo.alt;
    lightboxCaption.textContent = `${set.caption} — ${lightboxIndex + 1} / ${set.photos.length}`;
  }

  function openLightbox(setKey, index) {
    currentSetKey = setKey;
    lightboxIndex = index;
    updateLightbox();
    photoOpener = document.activeElement;
    lightbox.hidden = false;
    shell.inert = true;
    lightbox.querySelector('[data-lightbox-close]').focus();
  }

  function closeLightbox() {
    lightbox.hidden = true;
    shell.inert = false;
    photoOpener?.focus({ preventScroll: true });
  }

  function stepLightbox(delta) {
    const set = GALLERY_SETS[currentSetKey];
    lightboxIndex = (lightboxIndex + delta + set.photos.length) % set.photos.length;
    updateLightbox();
  }

  lightbox?.querySelector("[data-lightbox-close]")?.addEventListener("click", closeLightbox);
  lightbox?.querySelector("[data-lightbox-prev]")?.addEventListener("click", () => stepLightbox(-1));
  lightbox?.querySelector("[data-lightbox-next]")?.addEventListener("click", () => stepLightbox(1));
  lightbox?.addEventListener("click", (event) => {
    if (event.target === lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (lightbox?.hidden) return;
    if (['Escape', 'ArrowLeft', 'ArrowRight'].includes(event.key)) event.preventDefault();
    if (event.key === 'Escape') closeLightbox();
    if (event.key === 'ArrowLeft') stepLightbox(-1);
    if (event.key === 'ArrowRight') stepLightbox(1);
    if (event.key === 'Tab') {
      const controls = [...lightbox.querySelectorAll('button')];
      const index = controls.indexOf(document.activeElement);
      event.preventDefault();
      controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
    }
  });
}
