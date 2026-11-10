// Splitting a fleet. On top the two parts side by side - what stays, what
// leaves - with their numbers. Below one row per kind of ship (same type and
// tech level; a named ship is one of a kind): a slider and - / + say how many
// of that kind change to the new fleet. That works the same with a finger as
// with the mouse, without dragging between columns that do not even fit next
// to each other on a phone.
// "Each ship a fleet of its own" makes the new part one fleet per ship, and
// "all single" breaks up the whole fleet at once - five colony ships, five
// worlds. In flight both parts keep the course until the new one gets its own.
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
        <button class="sp-all"></button>
      </div>
      <div class="sp-list"></div>
      <label class="chk sp-each"><input type="checkbox"> <span></span></label>
    </div>
    <div class="sp-foot">
      <span class="sp-warn small"></span>
      <div class="sp-btns">
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
    if (!splittable(ids.length)) return;
    const done = current.onSplit, each = current.each;
    close();
    done(ids, each);
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
  modal.querySelector('.sp-all').onclick = () => {
    for (const g of current.groups) setCount(g, g.ships.length);
    current.each = true;
    modal.querySelector('.sp-each input').checked = true;
    render();
  };
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
  current = { fleet, color: o.color, onSplit: o.onSplit, groups: groupShips(fleet.ships), each: false };
  modal.querySelector('.sp-title').textContent = t('split.title');
  modal.querySelector('.sp-x').title = t('fleet.splitCancel');
  modal.querySelector('.sp-hint').textContent = !o.flight ? t('split.hint')
    : t('split.hint') + ' ' + (o.flight.target ? t('split.hintFlight', { planet: o.flight.target }) : t('split.hintAdrift'));
  modal.querySelector('[data-side="keep"] .sp-name').textContent = t('split.keep');
  modal.querySelector('.sp-each input').checked = false;
  modal.querySelector('.sp-each span').textContent = t('split.each');
  modal.querySelector('.sp-none').textContent = t('split.none');
  modal.querySelector('.sp-half').textContent = t('split.half');
  modal.querySelector('.sp-all').textContent = t('split.allSingle');
  modal.querySelector('.sp-all').title = t('split.allSingleTitle', { n: fleet.ships.length });
  modal.querySelector('.sp-cancel').textContent = t('fleet.splitCancel');
  // With a single kind of ship the quick buttons say nothing the slider
  // does not; "all single" stays, it is the one thing a slider cannot do.
  modal.querySelector('.sp-half').hidden = fleet.ships.length < 2;
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

/**
 * Can this many ships go? One fleet per ship may take them all - the first
 * then stays behind as the old fleet.
 */
function splittable(moving) {
  return moving > 0 && (current.each || moving < current.fleet.ships.length);
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
    // One fleet per ship: summed stats would describe no fleet at all.
    el.querySelector('.sp-stats').textContent = !ships.length ? '–'
      : side === 'new' && current.each ? t('split.fleets', { count: ships.length })
      : t('split.stats', { attack: fmt(st.attack), speed: fmt(st.speed), range: fmt(st.range) });
  }
  modal.querySelector('[data-side="new"] .sp-name').textContent = t(current.each ? 'split.newEach' : 'split.new');

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

  const ok = splittable(moving.length);
  const doBtn = modal.querySelector('.sp-do');
  doBtn.disabled = !ok;
  doBtn.textContent = !moving.length ? t('fleet.splitDo')
    : current.each ? t('split.doEach', { count: moving.length })
    : t('split.doN', { count: moving.length });
  // Only worth a word once something has been moved and one side ran empty.
  modal.querySelector('.sp-warn').textContent = moving.length && !ok ? t('split.needBoth') : '';
}
