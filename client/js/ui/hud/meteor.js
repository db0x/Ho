// The panel of a selected meteor: how much ore, how fast, how long it is
// still on the map, who is after it - and the button that sends the last
// own fleet to catch it. Whoever catches it takes all of it.
import { holeZone, meteorMeet, oreOf } from '../../../shared/rules.js';
import { t } from '../../i18n.js';
import { nearestPlanet } from '../../render/courses.js';
import { METEOR_COLOR } from '../../render/meteors.js';
import { shipIcon } from '../../render/ships.js';
import { escapeHtml } from './format.js';

export const meteorMethods = {
  meteorPanel(box, m) {
    if (!m) { box.innerHTML = ''; return; }
    const v = this.view;
    const near = nearestPlanet(v, m);
    const speed = Math.round(Math.hypot(m.vx, m.vy, m.vz || 0));
    const bound = v.fleets.filter(f => f.catch === m.id);
    box.innerHTML = `
      <div class="sel-head"><div>
        <div class="sel-title" style="color:${METEOR_COLOR}">${t('meteor.name')}</div>
        <div class="sel-sub">${near ? t('meteor.near', { planet: escapeHtml(near.name) }) : ''}</div>
      </div></div>
      <div class="statgrid cols3">
        <div class="stat"><div class="k">${t('meteor.oreShort')}</div><div class="v">${m.metal}</div></div>
        <div class="stat"><div class="k">${t('fleet.speed')}</div><div class="v">${speed} ${t('unit.lyPerTurn')}</div></div>
        <div class="stat"><div class="k">${t('meteor.leftShort')}</div><div class="v">${t('word.turns', { n: m.left, count: m.left })}</div></div>
      </div>
      <p class="hint-line">${t('meteor.hint')}</p>
      ${bound.length && near ? `<div class="sec"><h4>${t('meteor.bound')}</h4>${bound.map(f => this.fleetRow(f, near)).join('')}</div>` : ''}
      ${v.spectator ? '' : this.catchButton(m)}`;
    // One copy per row - shipIcon keeps every image only once (see planetPanel).
    for (const g of box.querySelectorAll('.ci')) {
      const ic = shipIcon(g.dataset.t, 18, g.dataset.c);
      const copy = document.createElement('canvas');
      copy.width = ic.width; copy.height = ic.height;
      copy.getContext('2d').drawImage(ic, 0, 0);
      g.appendChild(copy);
    }
    for (const item of box.querySelectorAll('[data-fleet]')) {
      item.onclick = () => this.app.setSelection({ type: 'fleet', id: item.dataset.fleet });
    }
    const b = box.querySelector('#catch');
    if (b) b.onclick = () => this.app.orderCatch(m.id);
  },

  /**
   * Catch it with the last own fleet: only with transporters, only if they
   * meet it before it is gone, and only within range - the
   * same checks as the server's, so the button does not promise too much.
   */
  catchButton(m) {
    const v = this.view;
    const f = v.fleets.find(x => x.id === this.lastFleetId);
    if (!f || !f.mine) return `<p class="hint-line">${t('meteor.pickFleet')}</p>`;
    let reason = null, meet = null;
    if (!oreOf(f.ships).hold) reason = t('meteor.needTransport');
    else {
      const src = f.at != null ? v.planets[f.at] : f;
      meet = meteorMeet(src, f.stats?.speed || 0, m, holeZone(v.galaxy));
      reason = meet ? this.whyNot(f, meet.at) : t('meteor.tooFast');
    }
    const label = t('meteor.catchButton', { n: f.ships.length });
    return `<div class="sel-actions"><button id="catch" class="primary"${reason ? ' disabled' : ''}>${label}</button></div>`
      + (reason ? `<p class="hint-line" style="color:var(--bad)">${t('fleet.cannotCatch', { reason })}</p>`
        : `<p class="hint-line">${t('meteor.meetIn', { n: meet.turns, count: meet.turns, ore: m.metal })}</p>`);
  }
};
