// Splitting a fleet: two columns, the ships move between them by drag and
// drop - with the mouse or a finger. Ships of the same type and tech level
// form one stack: dragging moves the whole stack, a tap moves a single ship.
// The right column can also become one fleet per ship ("each"), and "all
// single" breaks up the whole fleet at once - five colony ships, five worlds.
// In flight both parts keep the course until the new one gets its own.
// The window lives outside the selection panel, so a new view arriving in
// the meantime does not throw away what has been put together.
import { shipIcon } from '../render/ships.js';
import { t, localeTag } from '../i18n.js';

const fmt = n => Math.round(n).toLocaleString(localeTag());
const DRAG_START = 6;        // px of movement before a press becomes a drag

let modal = null, current = null;

function build() {
  modal = document.createElement('div');
  modal.id = 'split';
  modal.className = 'modal hidden';
  modal.innerHTML = `<div class="modal-box split-box">
    <h2 class="sp-title"></h2>
    <p class="muted small sp-hint"></p>
    <div class="sp-cols">
      <section class="sp-col" data-side="keep">
        <header><b class="sp-name"></b><span class="sp-count"></span></header>
        <div class="sp-stats muted small"></div>
        <div class="sp-list"></div>
      </section>
      <div class="sp-arrow" aria-hidden="true">⇄</div>
      <section class="sp-col" data-side="new">
        <header><b class="sp-name"></b><span class="sp-count"></span></header>
        <div class="sp-stats muted small"></div>
        <label class="chk sp-each"><input type="checkbox"> <span></span></label>
        <div class="sp-list"></div>
      </section>
    </div>
    <div class="sp-foot">
      <button class="sp-all"></button>
      <span class="sp-warn small"></span>
      <button class="sp-cancel"></button>
      <button class="primary sp-do"></button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('.sp-cancel').onclick = close;
  const submit = (ids, each) => {
    const done = current.onSplit;
    close();
    done(ids, each);
  };
  modal.querySelector('.sp-do').onclick = () => {
    const ids = current.fleet.ships.filter(s => current.side.get(s.id) === 'new').map(s => s.id);
    if (splittable(ids.length)) submit(ids, current.each);
  };
  modal.querySelector('.sp-all').onclick = () => submit(current.fleet.ships.map(s => s.id), true);
  modal.querySelector('.sp-each input').onchange = (e) => { current.each = e.target.checked; render(); };
  // In the capture phase, so Escape does not also clear the selection on the map.
  addEventListener('keydown', (e) => {
    if (current && e.key === 'Escape') { e.stopPropagation(); close(); }
  }, true);
}

/**
 * @param {object} fleet          own fleet from the view (ships with id, type, tech, hp ...)
 * @param {object} o              { color, flight: { target } | null, onSplit(shipIds, each) }
 */
export function openSplit(fleet, o) {
  if (!modal) build();
  current = { fleet, color: o.color, onSplit: o.onSplit, side: new Map(fleet.ships.map(s => [s.id, 'keep'])), each: false };
  modal.querySelector('.sp-title').textContent = t('split.title');
  modal.querySelector('.sp-hint').textContent = !o.flight ? t('split.hint')
    : t('split.hint') + ' ' + (o.flight.target ? t('split.hintFlight', { planet: o.flight.target }) : t('split.hintAdrift'));
  modal.querySelector('[data-side="keep"] .sp-name').textContent = t('split.keep');
  modal.querySelector('[data-side="new"] .sp-name').textContent = t('split.new');
  modal.querySelector('.sp-each input').checked = false;
  modal.querySelector('.sp-each span').textContent = t('split.each');
  modal.querySelector('.sp-all').textContent = t('split.allSingle');
  modal.querySelector('.sp-all').title = t('split.allSingleTitle', { n: fleet.ships.length });
  modal.querySelector('.sp-cancel').textContent = t('fleet.splitCancel');
  modal.querySelector('.sp-do').textContent = t('fleet.splitDo');
  render();
  modal.classList.remove('hidden');
}

function close() {
  current = null;
  modal?.classList.add('hidden');
}

/**
 * Can this many ships on the right go? One fleet per ship may take them
 * all - the first then stays behind as the old fleet.
 */
function splittable(moving) {
  return moving > 0 && (current.each || moving < current.fleet.ships.length);
}

/** Ships of one side, grouped by type and built-in tech. */
function stacks(side) {
  const out = new Map();
  for (const s of current.fleet.ships) {
    if (current.side.get(s.id) !== side) continue;
    const key = `${s.type}:${s.tech.weapons}/${s.tech.shields}/${s.tech.speed}`;
    if (!out.has(key)) out.set(key, { key, type: s.type, tech: s.tech, ships: [] });
    out.get(key).ships.push(s);
  }
  return [...out.values()];
}

/** The same rule as fleetStats on the server: slowest ship, best range plus tankers. */
function sideStats(ships) {
  let speed = Infinity, range = 0, attack = 0, tankers = 0;
  for (const s of ships) {
    if (s.speed > 0) speed = Math.min(speed, s.speed);
    range = Math.max(range, s.range);
    attack += s.attack;
    if (s.type === 'tanker') tankers++;
  }
  if (tankers > 1) range += range * 0.15 * (tankers - 1);
  return { speed: Number.isFinite(speed) ? speed : 0, range, attack };
}

function render() {
  for (const side of ['keep', 'new']) {
    const col = modal.querySelector(`[data-side="${side}"]`);
    const list = col.querySelector('.sp-list');
    const ships = current.fleet.ships.filter(s => current.side.get(s.id) === side);
    col.querySelector('.sp-count').textContent = ships.length;
    if (side === 'new') col.querySelector('.sp-name').textContent = t(current.each ? 'split.newEach' : 'split.new');
    const st = sideStats(ships);
    // One fleet per ship: summed stats would describe no fleet at all.
    col.querySelector('.sp-stats').textContent = ships.length && !(side === 'new' && current.each)
      ? t('split.stats', { attack: fmt(st.attack), speed: fmt(st.speed), range: fmt(st.range) }) : ' ';
    list.innerHTML = '';
    const groups = stacks(side);
    if (!groups.length) {
      list.innerHTML = `<p class="sp-empty">${t('split.drop')}</p>`;
      continue;
    }
    for (const g of groups) {
      const el = document.createElement('div');
      el.className = 'sp-stack';
      el.title = t('split.moveOne');
      el.innerHTML = `<span class="sp-ic"></span>
        <span class="sp-label"><span class="sp-type">${t(`ship.${g.type}.name`)}</span>
          <span class="muted small">${t('tech.weapons.short')}${g.tech.weapons}/${t('tech.shields.short')}${g.tech.shields}/${t('tech.speed.short')}${g.tech.speed}</span></span>
        <b class="sp-n">${g.ships.length}×</b>`;
      // shipIcon keeps every image only once - draw a copy per stack.
      const ic = shipIcon(g.type, 26, current.color);
      const copy = document.createElement('canvas');
      copy.width = ic.width; copy.height = ic.height;
      copy.style.width = copy.style.height = '26px';
      copy.getContext('2d').drawImage(ic, 0, 0);
      el.querySelector('.sp-ic').appendChild(copy);
      grab(el, side, g);
      list.appendChild(el);
    }
  }
  const moving = current.fleet.ships.filter(s => current.side.get(s.id) === 'new').length;
  const ok = splittable(moving);
  modal.querySelector('.sp-do').disabled = !ok;
  // Only worth a word once something has been moved and one side ran empty.
  modal.querySelector('.sp-warn').textContent = moving && !ok ? t('split.needBoth') : '';
}

function move(ships, to) {
  for (const s of ships) current.side.set(s.id, to);
  render();
}

/**
 * Press on a stack: without movement it is a tap (one ship across), with
 * movement a drag (the whole stack, dropped on whichever column is under the
 * pointer). Pointer events, not HTML drag and drop - the latter does not
 * work with fingers on every tablet.
 */
function grab(el, side, group) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY;
    let ghost = null, over = null;
    const other = side === 'keep' ? 'new' : 'keep';

    const target = (x, y) => {
      const hit = document.elementFromPoint(x, y)?.closest('.sp-col');
      return hit && modal.contains(hit) ? hit : null;
    };
    const onMove = (ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_START) return;
        const r = el.getBoundingClientRect();
        ghost = el.cloneNode(true);
        ghost.classList.add('sp-ghost');
        ghost.style.width = r.width + 'px';
        // The canvas does not survive cloneNode - paint the icon again.
        const src = el.querySelector('canvas'), dst = ghost.querySelector('canvas');
        if (src && dst) dst.getContext('2d').drawImage(src, 0, 0);
        ghost.dataset.dx = String(sx - r.left);
        ghost.dataset.dy = String(sy - r.top);
        document.body.appendChild(ghost);
        el.classList.add('sp-lifted');
      }
      ghost.style.left = (ev.clientX - +ghost.dataset.dx) + 'px';
      ghost.style.top = (ev.clientY - +ghost.dataset.dy) + 'px';
      const col = target(ev.clientX, ev.clientY);
      if (col !== over) {
        over?.classList.remove('sp-over');
        over = col;
        if (over && over.dataset.side !== side) over.classList.add('sp-over');
      }
    };
    const onUp = (ev) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      over?.classList.remove('sp-over');
      if (!ghost) {
        if (ev.type === 'pointerup') move(group.ships.slice(-1), other);
        return;
      }
      ghost.remove();
      el.classList.remove('sp-lifted');
      const col = ev.type === 'pointerup' ? target(ev.clientX, ev.clientY) : null;
      if (col && col.dataset.side !== side) move(group.ships, col.dataset.side);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  });
}
