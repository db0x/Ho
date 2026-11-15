// Profile of a ship type: a large, animated image and the stats the ship
// would be built with. One window for all types - you can switch between
// them at the top. The image is a solid turning in space (ships3d.js) and
// can be turned by hand; without WebGL, and for the station - which is
// drawn at a slant around its world already - it is the flat drawing.
import { SHIP_DEFS, BUILD_TYPES, ALIEN_TYPES, shipCost, shipStats, TECH_START_LEVEL, TECH_FIELDS } from '../../shared/rules.js';
import { shipIcon, UPRIGHT } from '../render/ships.js';
import { MARK } from '../render/fighterlook.js';
import { drawShipHD } from '../render/shipshd.js';
import { shipStage3D, SOLID_FILL } from '../render/ships3d.js';
import { t, localeTag, onLocaleChange } from '../i18n.js';

const fmt = n => Math.round(n).toLocaleString(localeTag());
const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString(localeTag(), { maximumFractionDigits: 1 });
const STAGE = 250;           // edge length of the stage in CSS pixels
// Size on the stage relative to the others.
const STAGE_SIZE = { colony: 0.9, destroyer: 0.88, station: 0.92, stationSite: 0.92, alienFighter: 1.35, alienCarrier: 1.35 };

// In space: how far the view comes down from straight
// above, and how fast the ship turns by itself (radians per second).
const TILT = 0.95, TILT_MAX = 2.7, TURN = 0.45;

// The fighter changes its look with tech (fighterlook.js). Its profile can
// show each generation: tech levels typical of Mk I, II and III - picture
// and stats together, so they always belong to each other.
const FIGHTER_GENS = [5, 18, 32];

let modal = null, frame = 0, current = null;
/** The stage in space: null without WebGL. */
let solid = null;
/** How the ship stands, and the pointer turning it. */
const pose = { yaw: 0.6, tilt: TILT, last: 0, drag: null };

function build() {
  modal = document.createElement('div');
  modal.id = 'shipinfo';
  modal.className = 'modal hidden';
  modal.innerHTML = `<div class="modal-box shipinfo-box">
    <div class="si-tabs"></div>
    <div class="si-body">
      <div class="si-side">
        <div class="si-stage"><canvas class="si-flat"></canvas><canvas class="si-solid hidden"></canvas></div>
        <div class="si-variants hidden"></div>
      </div>
      <div class="si-text"></div>
    </div>
    <button class="primary si-close"></button>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('.si-close').onclick = close;
  const cv = modal.querySelector('.si-solid');
  solid = shipStage3D(cv);
  // Turning by hand: sideways around the vertical axis, up and down the view
  // from above. A finger moving up or down scrolls the window instead.
  cv.addEventListener('pointerdown', (e) => {
    pose.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    cv.setPointerCapture(e.pointerId);
    cv.classList.add('turning');
  });
  cv.addEventListener('pointermove', (e) => {
    const d = pose.drag;
    if (!d || d.id !== e.pointerId) return;
    pose.yaw += (e.clientX - d.x) * 0.012;
    if (e.pointerType !== 'touch') pose.tilt = Math.max(0, Math.min(TILT_MAX, pose.tilt - (e.clientY - d.y) * 0.01));
    d.x = e.clientX; d.y = e.clientY;
  });
  const release = (e) => {
    if (pose.drag?.id !== e.pointerId) return;
    pose.drag = null;
    cv.classList.remove('turning');
  };
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', release);
  // In the capture phase, so Escape does not also clear the selection on
  // the map.
  addEventListener('keydown', (e) => {
    if (current && e.key === 'Escape') { e.stopPropagation(); close(); }
  }, true);
  // Language change with the profile open: show it in the new language right away
  onLocaleChange(() => {
    if (!current) return;
    modal.querySelector('.si-close').textContent = t('shipinfo.close');
    render();
  });
}

/**
 * What a ship type needs before it can be built, as a readable list:
 * "Weapons 5 · Shields 5 · a world with 20M people". `need` is what
 * buildLock (shared/rules.js) returns, or the type's full requirements.
 */
export function needsText(need) {
  const parts = TECH_FIELDS.filter(f => need[f]).map(f => t('shipinfo.needTech', { tech: t(`tech.${f}.name`), level: need[f] }));
  if (need.pop) parts.push(t('shipinfo.needPop', { n: need.pop }));
  if (need.station) parts.push(t('shipinfo.needStation'));
  return parts.join(' · ');
}

/**
 * @param {string} type
 * @param {{tech?: Record<string, number>, color?: string, note?: string, types?: string[]}} o
 *   tech levels it would be built with (without: starting level), the empire
 *   color, a note below the stats and the types of the game (without capital
 *   ships in a classic game)
 */
export function openShipInfo(type, o = {}) {
  if (!SHIP_DEFS[type]) return;
  if (!modal) build();
  current = { type, own: o.tech || {}, gen: null, tech: o.tech || {}, color: o.color || '#4da6ff', note: o.note || '', types: o.types || [...BUILD_TYPES, ...ALIEN_TYPES] };
  modal.querySelector('.si-close').textContent = t('shipinfo.close');
  render();
  modal.classList.remove('hidden');
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(paint);
}

function close() {
  current = null;
  cancelAnimationFrame(frame);
  modal?.classList.add('hidden');
}

/** The generation buttons beneath the fighter: its own tech, Mk I - III. */
function variants() {
  const box = modal.querySelector('.si-variants');
  const show = current.type === 'fighter';
  box.classList.toggle('hidden', !show);
  current.tech = show && current.gen != null
    ? Object.fromEntries(TECH_FIELDS.map(f => [f, FIGHTER_GENS[current.gen]]))
    : current.own;
  if (!show) return;
  box.innerHTML = '';
  for (const g of [null, 0, 1, 2]) {
    const b = document.createElement('button');
    b.className = 'tiny' + (g === current.gen ? ' primary' : '');
    b.textContent = g == null ? t('shipinfo.variantOwn') : 'Mk ' + MARK[g];
    b.title = g == null ? t('shipinfo.variantOwnTip') : t('shipinfo.variantTip', { level: FIGHTER_GENS[g] });
    b.setAttribute('aria-pressed', String(g === current.gen));
    b.onclick = () => { current.gen = g; render(); };
    box.appendChild(b);
  }
}

function render() {
  variants();
  const { type, tech, color, note } = current;
  const def = SHIP_DEFS[type];
  const st = shipStats(type, tech);
  const base = shipStats(type, {});
  const cost = shipCost(type, tech);

  const tabs = modal.querySelector('.si-tabs');
  tabs.innerHTML = '';
  for (const kind of current.types) {
    const b = document.createElement('button');
    b.className = 'tiny' + (kind === type ? ' primary' : '');
    b.title = t(`ship.${kind}.name`);
    // shipIcon keeps every image only once - a copy, so it is not pulled out
    // of a build list.
    const ic = shipIcon(kind, 22, color, tech);
    const copy = document.createElement('canvas');
    copy.width = ic.width; copy.height = ic.height;
    copy.style.width = copy.style.height = '22px';
    copy.getContext('2d').drawImage(ic, 0, 0);
    b.append(copy, document.createTextNode(' ' + t(`ship.${kind}.name`)));
    b.onclick = () => { current.type = kind; render(); };
    tabs.appendChild(b);
  }

  // The value, and below it the base value once tech has improved it.
  const row = (k, v, baseValue, fmtf = fmt) => `<div class="stat"><div class="k">${k}</div>
    <div class="v">${v}</div>${baseValue != null ? `<div class="small muted">${t('shipinfo.base', { v: fmtf(baseValue) })}</div>` : ''}</div>`;
  const differs = (a, b) => Math.round(a * 10) !== Math.round(b * 10) ? b : null;
  const stats = [
    row(t('fleet.speed'), st.mobile ? `${fmt(st.speed)} ${t('unit.lyPerTurn')}` : t('shipinfo.immobile'),
      st.mobile ? differs(st.speed, base.speed) : null),
    // The aliens bring their own supply: no range to speak of.
    row(t('fleet.range'), st.range && !def.alien ? `${fmt(st.range)} ${t('unit.ly')}` : '–',
      st.range && !def.alien ? differs(st.range, base.range) : null),
    row(t('fleet.attack'), st.attack ? fmt1(st.attack) : '–',
      st.attack ? differs(st.attack, base.attack) : null, fmt1),
    row(t('fleet.hull'), `${fmt(st.maxHp)} HP`, differs(st.maxHp, base.maxHp)),
    st.guns > 1 ? row(t('shipinfo.guns'), t('shipinfo.gunsValue', { n: st.guns, attack: fmt1(st.attack / st.guns) })) : '',
    st.colonists ? row(t('shipinfo.colonists'), t('word.pop', { n: fmt(st.colonists) })) : '',
    st.cargo ? row(t('shipinfo.cargo'), t('shipinfo.cargoValue', { n: st.cargo })) : '',
    row(t('shipinfo.cost'), def.alien ? t('shipinfo.notBuildable') : `${fmt(cost.money)} ${t('unit.cr')} · ${fmt(cost.metal)} ${t('unit.metal')}`)
  ].join('');
  const levels = def.techs.map(f => `${t(`tech.${f}.name`)} ${tech[f] || TECH_START_LEVEL}`).join(' · ');

  modal.querySelector('.si-text').innerHTML = `
    <h2>${t(`ship.${type}.name`)}</h2>
    <p class="si-lead">${t(`ship.${type}.desc`)}</p>
    <div class="statgrid">${stats}</div>
    <p class="small muted">${def.alien ? t('shipinfo.alienTech') : t('shipinfo.techs', { list: levels })}${note ? '<br>' + note : ''}${def.requires
      ? '<br>' + t('shipinfo.requires', { list: needsText(def.requires) }) : ''}</p>
    <h4>${t('shipinfo.use')}</h4>
    <p class="si-use">${t(`ship.${type}.info`)}</p>`;
}

function paint(ms) {
  if (!current) return;
  const flat = modal.querySelector('.si-flat'), deep = modal.querySelector('.si-solid');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const s = ms / 1000;
  const dt = Math.min(0.1, Math.max(0, s - pose.last));
  pose.last = s;
  let inSpace = !!solid && !UPRIGHT.has(current.type);
  if (inSpace) {
    // Twice the screen's resolution, scaled down by the browser: smooth edges.
    const px = Math.round(STAGE * dpr * 2);
    if (deep.width !== px) {
      deep.width = deep.height = px;
      deep.style.width = deep.style.height = STAGE + 'px';
    }
    if (!pose.drag) pose.yaw += dt * TURN;
    inSpace = solid.draw({
      type: current.type,
      color: current.color,
      tech: current.tech,
      phase: s,
      yaw: pose.yaw,
      tilt: pose.tilt + (pose.drag ? 0 : Math.sin(s * 0.5) * 0.06),
      fill: SOLID_FILL[current.type] || 1
    });
    // The context is gone for good: the flat drawing from here on.
    if (!inSpace) solid = null;
  }
  flat.classList.toggle('hidden', inSpace);
  deep.classList.toggle('hidden', !inSpace);
  if (!inSpace) paintFlat(flat, dpr, s);
  frame = requestAnimationFrame(paint);
}

function paintFlat(cv, dpr, s) {
  const px = Math.round(STAGE * dpr);
  if (cv.width !== px) {
    cv.width = cv.height = px;
    cv.style.width = cv.style.height = STAGE + 'px';
  }
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, px, px);
  // Without propulsion a satellite only drifts and rotates; everything else
  // flies upwards, swaying slightly.
  const stationary = !SHIP_DEFS[current.type].speedMul;
  // The destroyer is the largest class everywhere - here it would run out
  // of the stage, flames included. The aliens have no flames and are shown
  // as large as the stage allows.
  const len = px * 0.58 * (STAGE_SIZE[current.type] || 1), S = len / 100;
  drawShipHD(ctx, {
    type: current.type,
    // Moved up a little: the flame needs room at the back.
    x: px / 2 + Math.sin(s * 0.7) * px * 0.015,
    y: px / 2 - (stationary || SHIP_DEFS[current.type].alien ? 0 : 10 * S) + Math.sin(s * 1.1) * px * 0.02,
    // The station stands upright, it only sways a little.
    angle: UPRIGHT.has(current.type) ? Math.sin(s * 0.5) * 0.02 : stationary ? s * 0.2 : -Math.PI / 2 + Math.sin(s * 0.6) * 0.1,
    len,
    color: current.color,
    phase: s,
    // A fighter shows the generation and equipment of this tech.
    tech: current.tech
  });
}
