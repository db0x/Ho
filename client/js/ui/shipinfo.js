// Steckbrief eines Schiffstyps: großes, bewegtes Bild und die Werte, mit denen
// das Schiff gebaut würde. Ein Fenster für alle Typen - oben lässt sich
// zwischen ihnen wechseln.
import { SHIP_DEFS, SHIP_TYPES, shipCost, shipStats, TECH_START_LEVEL } from '../../shared/rules.js';
import { shipIcon } from '../render/ships.js';
import { drawShipHD } from '../render/shipshd.js';
import { t, localeTag, onLocaleChange } from '../i18n.js';

const fmt = n => Math.round(n).toLocaleString(localeTag());
const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString(localeTag(), { maximumFractionDigits: 1 });
const BILD = 250;            // Kantenlänge der Bühne in CSS-Pixeln

let modal = null, frame = 0, offen = null;

function bauen() {
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
  modal.addEventListener('click', (e) => { if (e.target === modal) schliessen(); });
  modal.querySelector('.si-close').onclick = schliessen;
  // In der Erfassungsphase, damit Escape nicht zugleich die Auswahl auf der
  // Karte aufhebt.
  addEventListener('keydown', (e) => {
    if (offen && e.key === 'Escape') { e.stopPropagation(); schliessen(); }
  }, true);
  // Sprachwechsel bei offenem Steckbrief: gleich in der neuen Sprache zeigen
  onLocaleChange(() => {
    if (!offen) return;
    modal.querySelector('.si-close').textContent = t('shipinfo.close');
    zeigen();
  });
}

/**
 * @param {string} type
 * @param {{tech?: Record<string, number>, color?: string, note?: string}} o
 *   Techstand, mit dem gebaut würde (ohne: Startstufe), die Reichsfarbe und
 *   ein Hinweis unter den Werten
 */
export function openShipInfo(type, o = {}) {
  if (!SHIP_DEFS[type]) return;
  if (!modal) bauen();
  offen = { type, tech: o.tech || {}, color: o.color || '#4da6ff', note: o.note || '' };
  modal.querySelector('.si-close').textContent = t('shipinfo.close');
  zeigen();
  modal.classList.remove('hidden');
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(malen);
}

function schliessen() {
  offen = null;
  cancelAnimationFrame(frame);
  modal?.classList.add('hidden');
}

function zeigen() {
  const { type, tech, color, note } = offen;
  const def = SHIP_DEFS[type];
  const st = shipStats(type, tech);
  const basis = shipStats(type, {});
  const cost = shipCost(type, tech);

  const tabs = modal.querySelector('.si-tabs');
  tabs.innerHTML = '';
  for (const typ of SHIP_TYPES) {
    const b = document.createElement('button');
    b.className = 'tiny' + (typ === type ? ' primary' : '');
    b.title = t(`ship.${typ}.name`);
    // shipIcon hält jedes Bild nur einmal vor - eine Kopie, damit es nicht
    // aus einer Bauliste herausgezogen wird.
    const ic = shipIcon(typ, 22, color);
    const kopie = document.createElement('canvas');
    kopie.width = ic.width; kopie.height = ic.height;
    kopie.style.width = kopie.style.height = '22px';
    kopie.getContext('2d').drawImage(ic, 0, 0);
    b.append(kopie, document.createTextNode(' ' + t(`ship.${typ}.name`)));
    b.onclick = () => { offen.type = typ; zeigen(); };
    tabs.appendChild(b);
  }

  // Wert, und darunter der Grundwert, sobald die Technik ihn verbessert hat.
  const zeile = (k, v, grund, fmtf = fmt) => `<div class="stat"><div class="k">${k}</div>
    <div class="v">${v}</div>${grund != null ? `<div class="small muted">${t('shipinfo.base', { v: fmtf(grund) })}</div>` : ''}</div>`;
  const anders = (a, b) => Math.round(a * 10) !== Math.round(b * 10) ? b : null;
  const stats = [
    zeile(t('fleet.speed'), st.mobile ? `${fmt(st.speed)} ${t('unit.lyPerTurn')}` : t('shipinfo.immobile'),
      st.mobile ? anders(st.speed, basis.speed) : null),
    zeile(t('fleet.range'), st.range ? `${fmt(st.range)} ${t('unit.ly')}` : '–',
      st.range ? anders(st.range, basis.range) : null),
    zeile(t('fleet.attack'), st.attack ? fmt1(st.attack) : '–',
      st.attack ? anders(st.attack, basis.attack) : null, fmt1),
    zeile(t('fleet.hull'), `${fmt(st.maxHp)} HP`, anders(st.maxHp, basis.maxHp)),
    st.colonists ? zeile(t('shipinfo.colonists'), t('word.pop', { n: fmt(st.colonists) })) : '',
    zeile(t('shipinfo.cost'), `${fmt(cost.money)} ${t('unit.cr')} · ${fmt(cost.metal)} ${t('unit.metal')}`)
  ].join('');
  const stufen = def.techs.map(f => `${t(`tech.${f}.name`)} ${tech[f] || TECH_START_LEVEL}`).join(' · ');

  modal.querySelector('.si-text').innerHTML = `
    <h2>${t(`ship.${type}.name`)}</h2>
    <p class="si-lead">${t(`ship.${type}.desc`)}</p>
    <div class="statgrid">${stats}</div>
    <p class="small muted">${t('shipinfo.techs', { list: stufen })}${note ? '<br>' + note : ''}</p>
    <h4>${t('shipinfo.use')}</h4>
    <p class="si-use">${t(`ship.${type}.info`)}</p>`;
}

function malen(ms) {
  if (!offen) return;
  const cv = modal.querySelector('.si-stage canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const px = Math.round(BILD * dpr);
  if (cv.width !== px) {
    cv.width = cv.height = px;
    cv.style.width = cv.style.height = BILD + 'px';
  }
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, px, px);
  const s = ms / 1000;
  // Ohne Antrieb treibt ein Satellit nur und dreht sich; alles andere fliegt
  // leicht schwankend nach oben.
  const fest = !SHIP_DEFS[offen.type].speedMul;
  const len = px * 0.58, S = len / 100;
  drawShipHD(ctx, {
    type: offen.type,
    // Etwas nach oben gerückt: die Flamme braucht hinten Platz.
    x: px / 2 + Math.sin(s * 0.7) * px * 0.015,
    y: px / 2 - (fest ? 0 : 10 * S) + Math.sin(s * 1.1) * px * 0.02,
    angle: fest ? s * 0.2 : -Math.PI / 2 + Math.sin(s * 0.6) * 0.1,
    len,
    color: offen.color,
    phase: s
  });
  frame = requestAnimationFrame(malen);
}
