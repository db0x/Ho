// The panel of a selected world: what it is like, who holds it, its
// population and terraforming, its shipyard and its defenses.
import { ownerOf } from '../../owners.js';
import {
  habitability, planetCapacity, terraformable, terraformFullCost, terraLimits, IDEAL, planetIncome,
  planetMining, batteryStats
} from '../../../shared/rules.js';
import { isAlly } from '../../allies.js';
import { t } from '../../i18n.js';
import { SHIELD_MIN } from '../../render/fx.js';
import { planetThumb } from '../../render/planets.js';
import { shipIcon } from '../../render/ships.js';
import { fmt1, fmt, escapeHtml } from './format.js';

export const planetMethods = {
  planetPanel(box, p) {
    if (!p) { box.innerHTML = ''; return; }
    const v = this.view, me = v.me;
    const ownerP = p.owner ? v.players.find(q => q.id === p.owner) : null;
    // Careful: when spectating, v.you is null - an ownerless world would
    // otherwise be "mine" (null === null) and the panel would offer the
    // shipyard and terraforming.
    const isMine = !!v.you && p.owner === v.you;
    const econ = isMine || (v.spectator && !!p.owner);   // spectators see every balance
    const unknown = p.known === 'unknown';
    const orbit = v.fleets.filter(f => f.at === p.id);
    const myFleets = orbit.filter(f => f.mine);
    const incoming = v.fleets.filter(f => f.dest === p.id && f.at !== p.id)
      .sort((a, b) => this.eta(a, p) - this.eta(b, p));

    if (unknown) {
      box.innerHTML = `
        <div class="sel-head"><div><div class="sel-title">${p.name}</div>
        <div class="sel-sub">${t('planet.unknown')}</div></div></div>
        <p class="hint-line">${t('planet.scoutHint')}</p>
        ${this.courseButton(p)}`;
      this.wireCourse(box, p);
      return;
    }

    const hab = habitability(p);
    const cap = planetCapacity(p);
    // Spectators have no empire of their own: then the owner's tech counts.
    const radical = me ? me.tech.radical
      : (v.players.find(q => q.id === p.owner)?.tech?.radical ?? 1);
    const allow = terraformable(p, radical);
    const fullCost = terraformFullCost(p, radical);
    const lim = terraLimits(radical);
    const dT = p.temp - IDEAL.temp, dG = p.grav - IDEAL.grav;

    // Two parts: everything about the world scrolls, the shipyard below
    // keeps its height. The scrolled position survives the rebuild.
    const keep = box.querySelector('.sel-main')?.scrollTop || 0;
    box.classList.add('split');
    box.innerHTML = `
      <div class="sel-main">
      <div class="sel-head">
        <span id="thumb"></span>
        <div>
          <div class="sel-title">${p.name}${p.isHomeworld ? ' ★' : ''}</div>
          <div class="sel-sub">${ownerP ? `<span style="color:${ownerP.color}">${ownerP.name}</span>` : t('planet.unsettled')}
            ${isAlly(v, p.owner) ? ` · <span class="dip-state allied">${t('dip.ally')}</span>` : ''}
            ${p.known === 'memory' ? ` · ${t('planet.memory', { turn: p.turn })}` : ''}</div>
        </div>
      </div>

      ${this.courseButton(p)}

      <div class="statgrid">
        <div class="stat"><div class="k">${t('planet.temp')}</div><div class="v">${fmt1(p.temp)} °C</div>
          <div class="small muted">${dT === 0 ? t('planet.ideal')
            : t('planet.offIdeal', { delta: (dT > 0 ? '+' : '') + fmt1(dT) + ' °C' })}</div></div>
        <div class="stat"><div class="k">${t('planet.grav')}</div><div class="v">${(+p.grav).toFixed(2)} g</div>
          <div class="small muted">${Math.abs(dG) < 0.005 ? t('planet.ideal')
            : t('planet.offIdeal', { delta: (dG > 0 ? '+' : '') + dG.toFixed(2) + ' g' })}</div></div>
        <div class="stat"><div class="k">${t('planet.pop')}</div><div class="v">${t('planet.popValue', { pop: fmt1(p.pop), cap })}</div>
          <div class="meter"><i style="width:${cap ? Math.min(100, p.pop / cap * 100) : 0}%;background:#52d98a"></i></div></div>
        <div class="stat"><div class="k">${t('planet.habitability')}</div><div class="v">${Math.round(hab * 100)} %</div>
          <div class="meter"><i style="width:${hab * 100}%;background:linear-gradient(90deg,#4d7fe0,#52d98a)"></i></div></div>
        <div class="stat"><div class="k">${t('planet.ore')}</div><div class="v">${fmt(p.metalReserve)}</div>
          <div class="small muted">${p.metalReserve > 0 ? t('planet.oreGrade', { n: (+p.metalRichness).toFixed(2) }) : t('planet.deepMining')}</div></div>
        <div class="stat"><div class="k">${t(econ ? 'planet.yield' : 'planet.defense')}</div>
          <div class="v">${econ ? '+' + fmt(planetIncome(p)) : t('planet.satellitesShort', { n: p.defenses || 0 })}</div>
          <div class="small muted">${econ ? '+' + fmt(planetMining(p)) + ' ' + t('unit.metal')
            : t('planet.satellites', { n: p.defenses || 0, count: p.defenses || 0 })}</div></div>
      </div>

      ${isMine ? this.defenseSection(p, orbit) : ''}

      ${isMine ? `
      <div class="sec">
        <h4>${t('terra.title')}</h4>
        ${fullCost === 0 && allow.temp && allow.grav
          ? `<p class="small" style="color:var(--good)">${t('terra.perfect')}</p>`
          : `
          ${(!allow.temp || !allow.grav) ? `<p class="small" style="color:#ffb347">
              ${t('terra.radicalShort', {
                level: radical, temp: Math.round(lim.temp), grav: lim.grav.toFixed(2),
                what: t(!allow.temp && !allow.grav ? 'terra.whatBoth'
                  : (!allow.temp ? 'terra.whatTemp' : 'terra.whatGrav'))
              })}</p>` : ''}
          ${fullCost > 0 ? `
          <label class="field slim" style="margin:6px 0">
            <span>${t('terra.budget')} <b id="tb-val">${fmt(p.terraBudget || 0)}</b></span>
            <input type="range" id="tb" min="0" max="${Math.max(10, Math.min(fullCost, Math.max(me.money, p.terraBudget || 0)))}" step="10" value="${p.terraBudget || 0}">
          </label>
          <div class="small muted">${t('terra.totalCost', { cost: fmt(fullCost) })}
            ${p.terraBudget ? ' ' + t('terra.readyIn', { n: Math.ceil(fullCost / p.terraBudget) }) : ''}</div>
          <div class="sel-actions">
            <button class="tiny" id="tb-full">${t('terra.full')}</button>
            <button class="tiny" id="tb-off">${t('terra.stop')}</button>
          </div>` : ''}
        `}
      </div>
      ` : ''}

      ${orbit.length ? `
      <div class="sec">
        <h4>${t('fleet.inOrbit')}</h4>
        <div class="shiplist">${orbit.map(f => this.fleetRow(f, p)).join('')}</div>
      </div>` : ''}

      ${incoming.length ? `
      <div class="sec">
        <h4>${t('fleet.incoming')}</h4>
        <div class="shiplist">${incoming.map(f => this.fleetRow(f, p)).join('')}</div>
      </div>` : ''}

      ${myFleets.some(f => f.ships.some(s => s.colonists > 0)) ? (!p.owner
        ? `<p class="hint-line" style="color:var(--good)">${t('fleet.colonyAboard')}</p>`
        : (isMine && p.pop < cap
          ? `<div class="sel-actions"><button class="tiny" id="unload">${t('fleet.unload')}</button></div>`
          : '')) : ''}
      </div>

      ${isMine ? (p.pop >= 1 ? `
      <div class="sel-yard">
        <h4>${t('yard.title')}</h4>
        <div id="buildrows"></div>
        <div class="small muted" id="buildsum"></div>
        ${this.refitBlock('p:' + p.id, t('refit.satellites'))}
        ${this.recycleBlock('p:' + p.id)}
      </div>` : `<div class="sel-yard"><h4>${t('yard.title')}</h4><p class="small muted">${t('yard.needPop')}</p></div>`) : ''}
    `;
    box.querySelector('.sel-main').scrollTop = keep;

    const th = box.querySelector('#thumb');
    if (th) th.appendChild(planetThumb(p, 46, this.view.players.find(q => q.id === p.owner)?.color));
    // shipIcon keeps every image only once - one copy per row, otherwise it
    // wanders into the last fleet of the same color.
    for (const g of box.querySelectorAll('.ci')) {
      const ic = shipIcon(g.dataset.t, 18, g.dataset.c);
      const copy = document.createElement('canvas');
      copy.width = ic.width; copy.height = ic.height;
      copy.getContext('2d').drawImage(ic, 0, 0);
      g.appendChild(copy);
    }

    const tb = box.querySelector('#tb');
    if (tb) {
      tb.oninput = (e) => {
        p.terraBudget = +e.target.value;
        box.querySelector('#tb-val').textContent = fmt(+e.target.value);
        this.sendSlider({ t: 'orders', terraform: { planetId: p.id, budget: +e.target.value } });
      };
      tb.onchange = (e) => this.app.send({ t: 'orders', terraform: { planetId: p.id, budget: +e.target.value } });
      box.querySelector('#tb-full').onclick = () => {
        const val = Math.min(fullCost, me.money);
        this.app.send({ t: 'orders', terraform: { planetId: p.id, budget: val } });
      };
      box.querySelector('#tb-off').onclick = () => {
        this.app.send({ t: 'orders', terraform: { planetId: p.id, budget: 0 } });
      };
    }

    const rows = box.querySelector('#buildrows');
    if (rows) this.buildRows(rows, box.querySelector('#buildsum'), p);

    this.wireRefit(box);
    this.wireRecycle(box);
    const ul = box.querySelector('#unload');
    if (ul) ul.onclick = () => {
      this.app.send({ t: 'orders', unload: { planetId: p.id } });
      this.toast(t('fleet.unloadToast'));
    };

    for (const item of box.querySelectorAll('[data-fleet]')) {
      item.onclick = () => this.app.setSelection({ type: 'fleet', id: item.dataset.fleet });
    }
    this.wireCourse(box, p);
  },

  /**
   * Defense of an own world: the planetary defense that grows with the
   * population, the satellites including the shield, the firepower in
   * orbit - and a warning when enemies are there or on their way.
   */
  defenseSection(p, orbit) {
    const v = this.view, me = v.me;
    const bat = batteryStats(p.pop, me.tech);
    const ds = p.defenseStats;
    const n = p.defenses || 0;
    const own = orbit.filter(f => f.mine).reduce((a, f) => a + (f.stats.attack || 0), 0);
    const total = (bat?.attack || 0) + (ds?.attack || 0) + own;
    const enemyOrbit = orbit.filter(f => !f.mine);
    const enemyIncoming = v.fleets.filter(f => !f.mine && f.dest === p.id && f.at !== p.id);
    const ships = (f) => t('word.ships', { n: f.ships.length, count: f.ships.length });
    const warnings = [
      ...enemyOrbit.map(f => t('def.enemyOrbit', {
        player: escapeHtml(ownerOf(v, f.owner)?.name || '?'), ships: ships(f) })),
      ...enemyIncoming.map(f => t(f.eta ? 'def.enemyIncoming' : 'def.enemyIncomingNoEta', {
        player: escapeHtml(ownerOf(v, f.owner)?.name || '?'), ships: ships(f),
        turns: f.eta ? t('word.turns', { n: f.eta, count: f.eta }) : '' }))
    ];
    const outdated = ds && (ds.weapons < me.tech.weapons || ds.shields < me.tech.shields);
    return `
      <div class="sec">
        <h4>${t('def.title')}</h4>
        ${warnings.map(w => `<p class="def-warn">⚠ ${w}</p>`).join('')}
        <div class="statgrid">
          <div class="stat"><div class="k">${t('def.battery')}</div>
            <div class="v">${bat ? fmt1(bat.attack) + ' ⚔' : '–'}</div>
            <div class="small muted">${bat ? t('def.batteryInfo', { hp: fmt(bat.hp) }) : t('def.batteryNone')}</div></div>
          <div class="stat"><div class="k">${t('def.satellites')}</div>
            <div class="v">${n}${ds ? ` · ${fmt1(ds.attack)} ⚔` : ''}</div>
            ${ds ? `<div class="small muted">${fmt(ds.hp)}/${fmt(ds.maxHp)} HP</div>
              <div class="meter"><i style="width:${ds.maxHp ? ds.hp / ds.maxHp * 100 : 0}%;background:var(--good)"></i></div>`
              : `<div class="small muted">${t('def.satNone')}</div>`}</div>
        </div>
        ${n >= SHIELD_MIN ? `<p class="hint-line" style="color:var(--good)">⬡ ${t('def.shieldOn')}</p>`
          : n > 0 ? `<p class="hint-line">${t('def.shieldSoon', { n: SHIELD_MIN - n, count: SHIELD_MIN - n })}</p>` : ''}
        ${outdated ? `<p class="hint-line">${t('def.satTech', { w: ds.weapons, s: ds.shields, W: me.tech.weapons, S: me.tech.shields })}</p>` : ''}
        <div class="def-total"><span>${t('def.total')}</span><b>${fmt1(total)} ⚔</b></div>
        <div class="small muted">${t('def.totalHint')}</div>
      </div>`;
  }
};
