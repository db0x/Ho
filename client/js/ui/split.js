// Splitting a fleet. On top the two parts side by side - what stays, what
// leaves - with their numbers. Below one row per kind of ship (same type and
// tech level; a named ship is one of a kind): a slider and - / + say how many
// of that kind change to the new fleet. That works the same with a finger as
// with the mouse, without dragging between columns that do not even fit next
// to each other on a phone.
// Apart from that, at the foot next to cancel: break the whole fleet up into
// single ships right away - five colony ships, five worlds. A different
// action, so it does not mix with the sliders. In flight both parts keep the
// course until the new one gets its own.
// The window lives outside the selection panel, so a new view arriving in
// the meantime does not throw away what has been put together.
import { shipIcon } from '../render/ships.js';
import { t, localeTag } from '../i18n.js';

const fmt = n => Math.round(n).toLocaleString(localeTag());
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let modal = null, current = null;

function build() {
  modal = document.createElement('div');
  modal.id = 'split';
  modal.className = 'modal hidden';
  modal.innerHTML = `<div class="modal-box split-box" role="dialog" aria-modal="true">
    <div class="sp-head">
      <h2 class="sp-title"></h2>
      <button class="sp-x" aria-label="×">×</button>
    </div>
    <div class="sp-body">
      <p class="muted small sp-hint"></p>
      <div class="sp-sides">
        <div class="sp-side" data-side="keep">
          <span class="sp-name"></span>
          <b class="sp-count"></b>
          <span class="sp-stats"></span>
        </div>
        <div class="sp-side" data-side="new">
          <span class="sp-name"></span>
          <b class="sp-count"></b>
          <span class="sp-stats"></span>
        </div>
      </div>
      <div class="sp-quick">
        <button class="sp-none"></button>
        <button class="sp-half"></button>
      </div>
      <div class="sp-list"></div>
    </div>
    <div class="sp-foot">
      <span class="sp-warn small"></span>
      <div class="sp-btns">
        <button class="sp-all"></button>
        <button class="sp-cancel"></button>
        <button class="primary sp-do"></button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('.sp-cancel').onclick = close;
  modal.querySelector('.sp-x').onclick = close;
  modal.querySelector('.sp-do').onclick = () => {
    const ids = movingIds();
    if (!splittable(ids.length) || strands().why) return;
    const done = current.onSplit;
    close();
    done(ids, false);
  };
  modal.querySelector('.sp-none').onclick = () => { for (const g of current.groups) setCount(g, 0); render(); };
  modal.querySelector('.sp-half').onclick = () => {
    // Half of every kind; a lone ship of a kind goes along every second time,
    // so a mixed fleet still ends up split down the middle.
    let odd = 0;
    for (const g of current.groups) {
      const n = g.ships.length;
      setCount(g, n % 2 ? Math.floor(n / 2) + (odd++ % 2) : n / 2);
    }
    render();
  };
  // One fleet per ship, the whole fleet - goes right away.
  modal.querySelector('.sp-all').onclick = () => {
    if (singlesStrand()) return;
    const ids = current.fleet.ships.map(s => s.id), done = current.onSplit;
    close();
    done(ids, true);
  };
  // In the capture phase, so Escape does not also clear the selection on the map.
  addEventListener('keydown', (e) => {
    if (current && e.key === 'Escape') { e.stopPropagation(); close(); }
  }, true);
}

/**
 * @param {object} fleet          own fleet from the view (ships with id, type, tech, hp ...)
 * @param {object} o              { color, flight: { target } | null, onSplit(shipIds, each),
 *                                  reach(ships, stats) -> reason | null: in flight, does a part still get anywhere }
 */
export function openSplit(fleet, o) {
  if (!modal) build();
  current = { fleet, color: o.color, onSplit: o.onSplit, groups: groupShips(fleet.ships), reach: o.reach || null };
  // Only parts that make it worse count: if the whole fleet reaches nothing anyway, nothing is held back.
  if (current.reach && reachOf(fleet.ships)) current.reach = null;
  modal.querySelector('.sp-title').textContent = t('split.title');
  modal.querySelector('.sp-x').title = t('fleet.splitCancel');
  modal.querySelector('.sp-hint').textContent = !o.flight ? t('split.hint')
    : t('split.hint') + ' ' + (o.flight.target ? t('split.hintFlight', { planet: o.flight.target }) : t('split.hintAdrift'));
  modal.querySelector('[data-side="keep"] .sp-name').textContent = t('split.keep');
  modal.querySelector('.sp-none').textContent = t('split.none');
  modal.querySelector('.sp-half').textContent = t('split.half');
  modal.querySelector('.sp-all').textContent = t('split.allSingle', { count: fleet.ships.length });
  modal.querySelector('.sp-all').title = t('fleet.splitKey');
  modal.querySelector('.sp-cancel').textContent = t('fleet.splitCancel');
  buildList();
  render();
  modal.classList.remove('hidden');
}

function close() {
  current = null;
  modal?.classList.add('hidden');
}

/** Ships grouped by type and built-in tech, each group with its count for the new fleet. */
function groupShips(ships) {
  const out = new Map();
  for (const s of ships) {
    // A named ship is one of a kind - it never stacks.
    const key = s.name ? `name:${s.id}` : `${s.type}:${s.tech.weapons}/${s.tech.shields}/${s.tech.speed}`;
    if (!out.has(key)) out.set(key, { key, type: s.type, tech: s.tech, name: s.name, ships: [], moving: 0 });
    out.get(key).ships.push(s);
  }
  return [...out.values()];
}

const setCount = (g, n) => { g.moving = Math.max(0, Math.min(g.ships.length, Math.round(n))); };
// The last ships of a group go - the same ones the old tap moved.
const movingShips = () => current.groups.flatMap(g => g.moving ? g.ships.slice(-g.moving) : []);
const movingIds = () => movingShips().map(s => s.id);

/** Can this many ships go? Something has to go, something has to stay. */
function splittable(moving) {
  return moving > 0 && moving < current.fleet.ships.length;
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

/** Why this part would be stranded in flight, or null (fleet.js partReach). */
function reachOf(ships) {
  if (!current.reach || !ships.length) return null;
  const st = sideStats(ships);
  return current.reach(ships, { ...st, range: Math.round(st.range) });
}

/** Which part of the split as set up would be stranded: { side, why } - side 'keep' or 'new'. */
function strands() {
  const moving = movingShips();
  if (!current.reach || !splittable(moving.length)) return { side: null, why: null };
  const going = new Set(moving.map(s => s.id));
  const keepWhy = reachOf(current.fleet.ships.filter(s => !going.has(s.id)));
  if (keepWhy) return { side: 'keep', why: keepWhy };
  const newWhy = reachOf(moving);
  return newWhy ? { side: 'new', why: newWhy } : { side: null, why: null };
}

/** Breaking up into single ships in flight: would one of them be stranded? */
function singlesStrand() {
  return !!current?.reach && current.fleet.ships.some(s => reachOf([s]));
}

/** One row per group - built once, render() only updates the numbers. */
function buildList() {
  const list = modal.querySelector('.sp-list');
  list.innerHTML = '';
  for (const g of current.groups) {
    const n = g.ships.length;
    const row = document.createElement('div');
    row.className = 'sp-row';
    row.innerHTML = `<div class="sp-what">
        <span class="sp-ic"></span>
        <span class="sp-label"><span class="sp-type">${g.name ? `<b>${escapeHtml(g.name)}</b> · ` : ''}${t(`ship.${g.type}.name`)}</span>
          <span class="muted small">${t('tech.weapons.short')}${g.tech.weapons}/${t('tech.shields.short')}${g.tech.shields}/${t('tech.speed.short')}${g.tech.speed}</span></span>
        <b class="sp-total">${n}×</b>
      </div>
      <div class="sp-ctl">
        <span class="sp-k"></span>
        <button class="sp-step sp-minus" aria-label="−">−</button>
        <input type="range" min="0" max="${n}" step="1" value="0">
        <button class="sp-step sp-plus" aria-label="+">+</button>
        <span class="sp-v"></span>
      </div>`;
    // shipIcon keeps every image only once - draw a copy per row.
    const ic = shipIcon(g.type, 28, current.color);
    const copy = document.createElement('canvas');
    copy.width = ic.width; copy.height = ic.height;
    copy.style.width = copy.style.height = '28px';
    copy.getContext('2d').drawImage(ic, 0, 0);
    row.querySelector('.sp-ic').appendChild(copy);
    const range = row.querySelector('input');
    range.setAttribute('aria-label', t('split.new'));
    range.oninput = () => { setCount(g, +range.value); render(); };
    row.querySelector('.sp-minus').onclick = () => { setCount(g, g.moving - 1); render(); };
    row.querySelector('.sp-plus').onclick = () => { setCount(g, g.moving + 1); render(); };
    // A tap on the ship itself: all of this kind across, or all back.
    row.querySelector('.sp-what').onclick = () => { setCount(g, g.moving ? 0 : n); render(); };
    g.row = row;
    list.appendChild(row);
  }
}

function render() {
  const moving = movingShips();
  const going = new Set(moving.map(s => s.id));
  const staying = current.fleet.ships.filter(s => !going.has(s.id));
  for (const [side, ships] of [['keep', staying], ['new', moving]]) {
    const el = modal.querySelector(`[data-side="${side}"]`);
    el.querySelector('.sp-count').textContent = ships.length;
    el.classList.toggle('sp-empty', !ships.length);
    const st = sideStats(ships);
    el.querySelector('.sp-stats').textContent = !ships.length ? '–'
      : t('split.stats', { attack: fmt(st.attack), speed: fmt(st.speed), range: fmt(st.range) });
  }
  modal.querySelector('[data-side="new"] .sp-name').textContent = t('split.new');

  for (const g of current.groups) {
    const n = g.ships.length, r = g.row;
    r.querySelector('input').value = g.moving;
    r.querySelector('input').style.setProperty('--p', (n ? g.moving / n * 100 : 0) + '%');
    r.querySelector('.sp-k').textContent = n - g.moving;
    r.querySelector('.sp-v').textContent = g.moving;
    r.querySelector('.sp-minus').disabled = g.moving === 0;
    r.querySelector('.sp-plus').disabled = g.moving === n;
    r.classList.toggle('sp-moving', g.moving > 0);
  }

  // In flight a part without the tanker may reach nothing anymore - such a
  // split is held back, and the tile of that part says so.
  const stranded = strands();
  for (const side of ['keep', 'new']) modal.querySelector(`[data-side="${side}"]`).classList.toggle('sp-strand', stranded.side === side);
  const ok = splittable(moving.length) && !stranded.why;
  const doBtn = modal.querySelector('.sp-do');
  doBtn.disabled = !ok;
  doBtn.textContent = !moving.length ? t('fleet.splitDo') : t('split.doN', { count: moving.length });
  // Only worth a word once something has been moved and one side ran empty - or would be stranded.
  modal.querySelector('.sp-warn').textContent = stranded.why
    ? t(stranded.side === 'new' ? 'split.strandsNew' : 'split.strandsKeep', { reason: stranded.why })
    : moving.length && !ok ? t('split.needBoth') : '';
  const all = modal.querySelector('.sp-all');
  const lost = singlesStrand();
  all.disabled = lost;
  all.title = lost ? t('split.strandsSingle') : t('fleet.splitKey');
}
