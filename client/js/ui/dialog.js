// Movable windows: the log and the dock at the top left. Deliberately kept
// generic: a bar for dragging, every edge and corner for resizing, a button
// (or a double click on the bar) to minimize the window to an icon, which
// brings it back to where it was. Position, size and the minimized state
// survive as a localStorage entry until the next start.

import { compact } from './viewport.js';

const TOP = 64;          // stay below the top bar
const MARGIN = 8;        // minimum distance to the screen edge
const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Order of the windows from back to front. The z values stay within a fixed
// band (from BASE_Z) - a counter that grows with every click would otherwise
// at some point push a window above the top bar including the ledger, and
// eventually even above the confirmations (.modal).
const stack = [];
const BASE_Z = 5;

function bringToFront(el) {
  stack.splice(stack.indexOf(el), 1);
  stack.push(el);
  stack.forEach((w, i) => { w.style.zIndex = String(BASE_Z + i); });
}

/**
 * @param {HTMLElement} el     the window itself
 * @param {object} o           { handle, grip, collapse, icon, key, x, y, w, h, minW, minH, onToggle }
 *   x/y: starting position without remembered geometry; without y the window sits at the bottom
 *   collapse: button that minimizes the window, icon: what stands in for it meanwhile
 * @returns {{refresh: () => void, toggle: (fold?: boolean) => void, collapsed: () => boolean}}
 */
export function makeDialog(el, o) {
  const narrow = compact;
  const minW = o.minW || 320, minH = o.minH || 150;
  const geo = Object.assign({ x: o.x ?? 12, y: o.y ?? null, w: o.w || 460, h: o.h || 240, collapsed: false }, load(o.key));
  // On small devices the window is a sheet: position and size are handled by
  // the stylesheet there, not by this module. The remembered geometry is kept
  // and applies again as soon as there is room again.

  function apply() {
    if (narrow.matches) {
      for (const prop of ['left', 'top', 'right', 'bottom', 'width', 'height']) {
        el.style.removeProperty(prop);
      }
      return;
    }
    geo.w = clamp(geo.w, minW, Math.max(minW, innerWidth - 2 * MARGIN));
    geo.h = clamp(geo.h, minH, Math.max(minH, innerHeight - TOP - MARGIN));
    // Without a saved position and without a default, start at the bottom
    // left, where the log always used to sit.
    if (geo.y == null) geo.y = innerHeight - geo.h - 12;
    geo.x = clamp(geo.x, MARGIN, Math.max(MARGIN, innerWidth - geo.w - MARGIN));
    geo.y = clamp(geo.y, TOP, Math.max(TOP, innerHeight - geo.h - MARGIN));
    el.style.left = geo.x + 'px';
    el.style.top = geo.y + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.width = geo.w + 'px';
    el.style.height = geo.h + 'px';
  }

  /**
   * Dragging and resizing work the same way, only the mapping differs.
   * mode: 'move' or an edge ('n', 'se', ...). On the left and top edge the
   * opposite edge stays put - the minimum size must not push the window away.
   */
  function grab(target, mode) {
    if (!target) return;
    target.addEventListener('pointerdown', (e) => {
      if (narrow.matches) return;          // sheet: nothing to move
      if (e.button !== 0 || e.target.closest('button, input')) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY;
      const s = { x: geo.x, y: geo.y, w: geo.w, h: geo.h };
      const maxW = innerWidth - 2 * MARGIN, maxH = innerHeight - TOP - MARGIN;
      target.setPointerCapture(e.pointerId);
      el.classList.add('dlg-busy');
      const move = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (mode === 'move') { geo.x = s.x + dx; geo.y = s.y + dy; apply(); return; }
        if (mode.includes('e')) geo.w = clamp(s.w + dx, minW, maxW);
        if (mode.includes('s')) geo.h = clamp(s.h + dy, minH, maxH);
        if (mode.includes('w')) { geo.w = clamp(s.w - dx, minW, maxW); geo.x = s.x + s.w - geo.w; }
        if (mode.includes('n')) { geo.h = clamp(s.h - dy, minH, maxH); geo.y = s.y + s.h - geo.h; }
        apply();
      };
      const up = () => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);
        el.classList.remove('dlg-busy');
        save(o.key, geo);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', up);
    });
  }

  /** Minimize to the icon or bring it back; without an argument it toggles. */
  function toggle(fold = !el.classList.contains('collapsed')) {
    el.classList.toggle('collapsed', fold);
    o.icon?.classList.toggle('hidden', !fold);
    geo.collapsed = fold;
    if (!fold && !narrow.matches) bringToFront(el);
    apply();
    save(o.key, geo);
    o.onToggle?.(fold);
  }

  // Whatever is touched comes to the front - otherwise a window dragged over
  // another one would disappear underneath it.
  // On a phone these are sheets with their own order (CSS) - set nothing there.
  stack.push(el);
  el.addEventListener('pointerdown', () => {
    if (narrow.matches) el.style.zIndex = '';
    else bringToFront(el);
  }, true);

  grab(o.handle, 'move');
  grab(o.grip, 'se');
  // Invisible strips along every edge and corner for resizing.
  for (const edge of EDGES) {
    const strip = document.createElement('div');
    strip.className = 'dlg-edge';
    strip.dataset.edge = edge;
    el.appendChild(strip);
    grab(strip, edge);
  }
  if (o.collapse) o.collapse.onclick = () => toggle(true);
  if (o.icon) o.icon.onclick = () => toggle(false);
  o.handle?.addEventListener('dblclick', (e) => { if (!e.target.closest('button, input')) toggle(true); });
  addEventListener('resize', apply);
  narrow.addEventListener('change', apply);
  if (geo.collapsed) toggle(true); else apply();
  return { refresh: apply, toggle, collapsed: () => el.classList.contains('collapsed') };
}

function load(key) {
  try {
    const g = JSON.parse(localStorage.getItem(key) || 'null');
    return g && typeof g.w === 'number' ? g : null;
  } catch { return null; }
}

function save(key, geo) {
  try { localStorage.setItem(key, JSON.stringify(geo)); } catch {}
}
