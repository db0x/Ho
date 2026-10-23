// Profile of a ship type: a large, animated image and the stats the ship
// would be built with. One window for all types - you can switch between
// them at the top.
import { SHIP_DEFS, SHIP_TYPES, shipCost, shipStats, TECH_START_LEVEL } from '../../shared/rules.js';
import { shipIcon } from '../render/ships.js';
import { drawShipHD } from '../render/shipshd.js';
import { t, localeTag, onLocaleChange } from '../i18n.js';

const fmt = n => Math.round(n).toLocaleString(localeTag());
const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString(localeTag(), { maximumFractionDigits: 1 });
const STAGE = 250;           // edge length of the stage in CSS pixels

let modal = null, frame = 0, current = null;

function build() {
  modal = document.createElement('div');
  modal.id = 'shipinfo';
  modal.className = 'modal hidden';
  modal.innerHTML = `<div class="modal-box shipinfo-box">
    <div class="si-tabs"></div>
    <div class="si-body">
      <div class="si-stage"><canvas></canvas></div>
      <div class="si-text"></div>
    </div>
    <button class="primary si-close"></button>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('.si-close').onclick = close;
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
 * @param {string} type
 * @param {{tech?: Record<string, number>, color?: string, note?: string}} o
 *   tech levels it would be built with (without: starting level), the empire
 *   color and a note below the stats
 */
export function openShipInfo(type, o = {}) {
  if (!SHIP_DEFS[type]) return;
  if (!modal) build();
  current = { type, tech: o.tech || {}, color: o.color || '#4da6ff', note: o.note || '' };
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

function render() {
  const { type, tech, color, note } = current;
  const def = SHIP_DEFS[type];
  const st = shipStats(type, tech);
  const base = shipStats(type, {});
  const cost = shipCost(type, tech);

  const tabs = modal.querySelector('.si-tabs');
  tabs.innerHTML = '';
  for (const kind of SHIP_TYPES) {
    const b = document.createElement('button');
    b.className = 'tiny' + (kind === type ? ' primary' : '');
    b.title = t(`ship.${kind}.name`);
    // shipIcon keeps every image only once - a copy, so it is not pulled out
    // of a build list.
    const ic = shipIcon(kind, 22, color);
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
    row(t('fleet.range'), st.range ? `${fmt(st.range)} ${t('unit.ly')}` : '–',
      st.range ? differs(st.range, base.range) : null),
    row(t('fleet.attack'), st.attack ? fmt1(st.attack) : '–',
      st.attack ? differs(st.attack, base.attack) : null, fmt1),
    row(t('fleet.hull'), `${fmt(st.maxHp)} HP`, differs(st.maxHp, base.maxHp)),
    st.colonists ? row(t('shipinfo.colonists'), t('word.pop', { n: fmt(st.colonists) })) : '',
    st.cargo ? row(t('shipinfo.cargo'), t('shipinfo.cargoValue', { n: st.cargo })) : '',
    row(t('shipinfo.cost'), `${fmt(cost.money)} ${t('unit.cr')} · ${fmt(cost.metal)} ${t('unit.metal')}`)
  ].join('');
  const levels = def.techs.map(f => `${t(`tech.${f}.name`)} ${tech[f] || TECH_START_LEVEL}`).join(' · ');

  modal.querySelector('.si-text').innerHTML = `
    <h2>${t(`ship.${type}.name`)}</h2>
    <p class="si-lead">${t(`ship.${type}.desc`)}</p>
    <div class="statgrid">${stats}</div>
    <p class="small muted">${t('shipinfo.techs', { list: levels })}${note ? '<br>' + note : ''}</p>
    <h4>${t('shipinfo.use')}</h4>
    <p class="si-use">${t(`ship.${type}.info`)}</p>`;
}

function paint(ms) {
  if (!current) return;
  const cv = modal.querySelector('.si-stage canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const px = Math.round(STAGE * dpr);
  if (cv.width !== px) {
    cv.width = cv.height = px;
    cv.style.width = cv.style.height = STAGE + 'px';
  }
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, px, px);
  const s = ms / 1000;
  // Without propulsion a satellite only drifts and rotates; everything else
  // flies upwards, swaying slightly.
  const stationary = !SHIP_DEFS[current.type].speedMul;
  const len = px * 0.58, S = len / 100;
  drawShipHD(ctx, {
    type: current.type,
    // Moved up a little: the flame needs room at the back.
    x: px / 2 + Math.sin(s * 0.7) * px * 0.015,
    y: px / 2 - (stationary ? 0 : 10 * S) + Math.sin(s * 1.1) * px * 0.02,
    angle: stationary ? s * 0.2 : -Math.PI / 2 + Math.sin(s * 0.6) * 0.1,
    len,
    color: current.color,
    phase: s
  });
  frame = requestAnimationFrame(paint);
}
