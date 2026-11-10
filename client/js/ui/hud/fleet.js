// Fleets: the panel of a selected fleet with its ships, names and cargo,
// the fleet rows other panels list - and whether a fleet can go somewhere.
import {
  travelDistance, holeZone, SHIP_DEFS, cargoOf, SHIP_TYPES, ALIEN_TYPES, supplyNeed, onMouth
} from '../../../shared/rules.js';
import { ownerOf, ownerColor } from '../../owners.js';
import { suppliesMe } from '../../allies.js';
import { t } from '../../i18n.js';
import { courseTarget, portalsOf } from '../../render/courses.js';
import { shipIcon } from '../../render/ships.js';
import { openSplit } from '../../ui/split.js';
import { escapeHtml, fmt, fmt1 } from './format.js';
import { refitShips } from '../../../shared/budget.js';
import { recycleRates, recycleValue } from '../../../shared/rules.js';

// Icons of the fleet actions, 16x16 in currentColor like the rest of the UI.
const svg = (d) => `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true">${d}</svg>`;
const FA_ICON = {
  stop: svg('<rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor"/>'),
  merge: svg('<path d="M3 3.5l5 4.5 5-4.5M8 8v5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'),
  split: svg('<path d="M8 13V8.5L3 4M8 8.5L13 4M3 4v3M3 4h3M13 4v3M13 4h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  refit: svg('<path d="M8 13V4M4 7.5L8 3.5l4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 13.2h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
  jump: svg('<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2.2 1.6"/><path d="M8 4.6a3.4 3.4 0 1 1-3.1 4.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/>'),
  recycle: svg('<path d="M12.6 6.2A5 5 0 0 0 3.6 5.4M3.4 9.8a5 5 0 0 0 9 .8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M3.2 2.6v3h3M12.8 13.4v-3h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>')
};

export const fleetMethods = {
  fleetPanel(box, f) {
    if (!f) { box.innerHTML = ''; return; }
    const v = this.view;
    // The last own fleet stays the one orders are for - also while a foreign
    // one is looked at (to intercept it from its panel).
    if (f.mine) this.lastFleetId = f.id;
    if (!f.mine && !v.spectator) {
      const pl = ownerOf(v, f.owner);
      // Detected means: course and arrival are known, the ships themselves are not.
      const target = courseTarget(v, f);
      // Fog of war: target out of sight, only the direction is known.
      const whither = target?.heading ? `<div class="sel-sub">${t('fleet.headingOnly')}</div>`
        : target
        ? `<div class="sel-sub">${t('fleet.courseTo', { planet: target.name ?? t('hole.name') }).replace('<b>', '<b style="color:var(--gold)">')}`
          + (f.eta ? ' ' + t('fleet.etaSuffix', { turns: t('word.turns', { n: f.eta, count: f.eta }) }) : '')
          + '</div>'
        : `<div class="sel-sub">${t('fleet.noCourse')}</div>`;
      // Big ships are known by name, like at sea - what else flies along is not.
      const names = f.ships.filter(s => s.name).map(s => escapeHtml(s.name));
      if (pl?.alien) {
        // The aliens make no secret of themselves: a carrier and its swarm,
        // there for everyone to see - and where to hit them.
        box.innerHTML = `<div class="sel-head"><div><div class="sel-title" style="color:${pl.color}">${t('alien.fleet')}</div>
          ${whither}</div></div>
          <div class="fr-sub"><span class="fr-comp">${this.composition(f, pl.color)}</span></div>
          <p class="hint-line">${t('alien.hint')}</p>
          ${this.chaseButton(f)}`;
        this.wireChase(box, f);
        for (const el of box.querySelectorAll('.ci')) {
          el.appendChild(shipIcon(el.dataset.t, 18, el.dataset.c));
          // Each type opens its profile in the ship overview.
          el.parentElement.classList.add('clickable-ship');
          el.parentElement.onclick = () => this.showShip(el.dataset.t);
        }
        return;
      }
      box.innerHTML = `<div class="sel-head"><div><div class="sel-title">${t('fleet.foreign')}</div>
        <div class="sel-sub" style="color:${pl?.color}">${pl?.name || '?'}</div>${whither}</div></div>
        <p class="hint-line">${t('fleet.detected', { ships: t('word.ships', { n: f.ships.length, count: f.ships.length }) })}</p>
        ${names.length ? `<p class="hint-line">${t('fleet.namedSeen', { names: names.join(', ') })}</p>` : ''}
        ${this.chaseButton(f)}`;
      this.wireChase(box, f);
      return;
    }
    const groups = {};
    for (const s of f.ships) (groups[s.type] || (groups[s.type] = [])).push(s);
    const where = f.at != null ? v.planets[f.at] : null;
    const destP = f.dest != null ? v.planets[f.dest] : null;
    const destM = f.hole ? courseTarget(v, f) : null;
    // Intercepting: whom, and how soon they meet.
    const prey = f.chase && f.aim ? v.fleets.find(x => x.id === f.chase) : null;
    const st = f.stats;
    // The path around the black hole counts, not the straight line.
    const turnsTo = destP || destM || f.aim
      ? Math.max(1, Math.ceil(travelDistance(f, destP || destM || f.aim, holeZone(v.galaxy)) / (st.speed || 1)))
      : 0;

    box.innerHTML = `
      <div class="sel-head">
        <div>
          <div class="sel-title">${v.spectator
            ? `<span style="color:${ownerOf(v, f.owner)?.color}">${escapeHtml(ownerOf(v, f.owner)?.name || '?')}</span> · `
            : ''}${t('fleet.title', { n: f.ships.length })}</div>
          <div class="sel-sub">${where ? t('fleet.atPlanet', { planet: where.name }) : t('fleet.enRoute')}
            ${destP ? ' ' + t('fleet.destSuffix', { planet: destP.name, turns: turnsTo })
              .replace('<b>', '<b style="color:var(--gold)">') : ''}
            ${destM ? ' ' + t('fleet.holeSuffix', { turns: turnsTo })
              .replace('<b>', '<b style="color:#cdb4ff">') : ''}
            ${f.chase && f.aim ? ' ' + t('fleet.chaseSuffix', { player: escapeHtml(ownerOf(v, prey?.owner)?.name || '?'), turns: turnsTo })
              .replace('<b>', '<b style="color:var(--bad)">') : ''}</div>
        </div>
      </div>
      ${f.mine && !v.spectator ? this.fleetActions(f, where, !!(destP || destM || f.chase)) : ''}
      <div class="statgrid cols4">
        <div class="stat"><div class="k">${t('fleet.speed')}</div><div class="v">${Math.round(st.speed)} ${t('unit.lyPerTurn')}</div></div>
        <div class="stat"><div class="k">${t('fleet.range')}</div><div class="v">${fmt(st.range)} ${t('unit.ly')}</div></div>
        <div class="stat"><div class="k">${t('fleet.attack')}</div><div class="v">${st.attack}</div></div>
        <div class="stat"><div class="k">${t('fleet.hull')}</div><div class="v">${Math.round(st.hp)}</div></div>
      </div>
      <div class="sec">
        <h4>${t('fleet.ships')}</h4>
        <div class="shiplist">
          ${f.ships.filter(s => s.name).map(s => `
            <div class="shipitem named clickable-ship" data-info="${s.type}" data-ship="${s.id}" title="${t('shipinfo.hint')}">
              <span class="gi" data-t="${s.type}"></span>
              <span class="si-named"><b class="ship-name">${escapeHtml(s.name)}</b>
                <span class="muted small">${t(`ship.${s.type}.name`)}</span></span>
              ${f.mine && !v.spectator ? `<button class="tiny rename" title="${t('fleet.rename')}" aria-label="${t('fleet.rename')}">✎</button>` : ''}
              <span class="hp">${Math.round(s.hp)}/${Math.round(s.maxHp)} HP</span>
            </div>`).join('')}
          ${Object.entries(groups).filter(([type]) => !SHIP_DEFS[type]?.named).map(([type, arr]) => `
            <div class="shipitem clickable-ship" data-info="${type}" title="${t('shipinfo.hint')}">
              <span class="gi" data-t="${type}"></span>
              <span>${arr.length}× ${t(`ship.${type}.name`)}
                <span class="muted small">(${t('tech.weapons.short')}${arr[0].tech.weapons}/${t('tech.shields.short')}${arr[0].tech.shields}/${t('tech.speed.short')}${arr[0].tech.speed})</span></span>
              <span class="hp">${Math.round(arr.reduce((a, s) => a + s.hp, 0))} HP</span>
            </div>`).join('')}
        </div>
      </div>
      ${f.mine && !v.spectator ? `<p class="hint-line fa-hint">${t('fleet.orderHint')}</p>` : ''}
      ${f.mine && !v.spectator ? this.cargoSection(f, where) : ''}`;

    const col = (f.mine && v.me) ? v.me.color
      : ownerColor(v, f.owner, '#9fb0c8');
    for (const g of box.querySelectorAll('.gi')) g.appendChild(shipIcon(g.dataset.t, 26, col));
    // The built-in tech of these ships, not the current levels
    for (const el of box.querySelectorAll('[data-info]')) {
      const ship = el.dataset.ship ? f.ships.find(s => s.id === el.dataset.ship) : groups[el.dataset.info][0];
      el.onclick = (e) => {
        if (e.target.closest('.rename, .rename-input')) return;
        this.showShip(el.dataset.info, ship.tech, col);
      };
    }
    for (const b of box.querySelectorAll('.rename')) b.onclick = () => this.rename(b.closest('[data-ship]'), f);
    const c = box.querySelector('#cancel');
    if (c) c.onclick = () => this.app.send({ t: 'orders', move: { fleetId: f.id, planetId: null } });
    const m = box.querySelector('#merge');
    if (m) m.onclick = () => this.app.send({ t: 'orders', merge: { planetId: f.at } });
    const jump = box.querySelector('#jump');
    if (jump) jump.onclick = () => { if (jump.getAttribute('aria-pressed') !== 'true') this.app.orderHole(jump.dataset.hole); };
    const sp = box.querySelector('#split');
    if (sp) sp.onclick = () => openSplit(f, {
      color: col,
      // In flight both parts keep the course - say so, with the target.
      flight: !where ? { target: destP ? destP.name : null } : null,
      // In flight every part keeps the course: does it still get anywhere
      // without the rest? Null if so, otherwise the reason (as the server, movement.js).
      reach: !where ? (ships, stats) => this.partReach(f, ships, stats) : null,
      onSplit: (ships, each) => this.app.send({ t: 'orders', split: { fleetId: f.id, ships, each } })
    });
    this.wireRefit(box);
    this.wireRecycle(box);
    this.wireCargo(box, f);
  },

  /**
   * Renaming a big ship right in the list: Enter or leaving the field takes
   * the name, Escape keeps the old one.
   */
  rename(item, f) {
    const ship = f.ships.find(s => s.id === item.dataset.ship);
    const label = item.querySelector('.ship-name');
    if (!ship || !label) return;
    const input = document.createElement('input');
    input.className = 'rename-input';
    input.maxLength = 28;
    input.value = ship.name;
    input.setAttribute('aria-label', t('fleet.rename'));
    label.replaceWith(input);
    item.querySelector('.rename')?.remove();
    input.focus();
    input.select();
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      input.blur();
      if (keep && name && name !== ship.name) {
        this.app.send({ t: 'orders', rename: { shipId: ship.id, name } });
      } else this.selection();
    };
    input.onkeydown = (e) => {
      // Keys belong to the field - not to the map and its shortcuts.
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    };
    input.onblur = () => finish(true);
  },

  /**
   * Hold of the transporters: what is aboard, and - in orbit of an own
   * world - taking satellites aboard and setting them down. Each direction
   * has its own counter, capped by what fits or is there.
   */
  /**
   * What can be done with an own fleet, as one row of buttons right under
   * its title - on a phone within reach without scrolling the sheet. Icon
   * over a short word, all the same width; the prices go in one line below.
   * Refit and recycle keep the data attributes, wireRefit / wireRecycle
   * work on them as on a planet.
   */
  fleetActions(f, where, moving) {
    const v = this.view, key = 'f:' + f.id;
    const btn = (id, ico, label, title, extra = '') =>
      `<button class="fa-btn"${id ? ` id="${id}"` : ''} title="${title}" aria-label="${title}"${extra}>${FA_ICON[ico]}<span>${label}</span></button>`;
    const out = [], info = [];
    if (moving) out.push(btn('cancel', 'stop', t('fleet.act.stop'), t('fleet.cancelCourse')));
    if (where && v.fleets.filter(x => x.mine && x.at === f.at).length > 1)
      out.push(btn('merge', 'merge', t('fleet.act.merge'), t('fleet.merge')));
    if (f.ships.length > 1) out.push(btn('split', 'split', t('fleet.act.split'), `${t('fleet.split')} – ${t('fleet.splitKey')}`));
    // Standing on a wormhole mouth (came out there): jump through it - always
    // possible, even where nothing on this side is in range.
    const mouth = f.at == null && (v.wormholes || []).find(m => onMouth(f, m));
    if (mouth) {
      const set = f.hole === mouth.id;
      out.push(btn('jump', 'jump', t('fleet.act.jump'), t(set ? 'hole.jumpSet' : 'hole.jumpTip'),
        ` data-hole="${mouth.id}"${set ? ' aria-pressed="true"' : ''}`));
    }
    if (where) {
      const pl = this.plan();
      const r = pl && this.refitFor(key, pl.tech);
      if (r) {
        const ordered = !!v.me.refit?.[key];
        const price = t('refit.cost', { n: r.count, count: r.count, money: fmt(r.money), metal: fmt(r.metal) });
        const ok = ordered || this.affordable({ refit: key });
        out.push(btn(null, 'refit', t('fleet.act.refit'), ordered ? t('refit.cancel') : ok ? t('refit.fleet') : t('yard.cantAfford'),
          ` data-refit="${key}"${ordered ? ' data-off="1" aria-pressed="true"' : ''}${ok ? '' : ' disabled'}`));
        info.push(ordered ? `<span style="color:var(--good)">${t('refit.ordered', { cost: price })}</span>` : price);
      }
      if (recycleRates(v.me.tech.recycling)) {
        const ships = refitShips(v, key);
        if (ships.length) {
          const val = recycleValue(ships, v.me.tech.recycling);
          const ok = this.recycleAffordable(val);
          const armed = this.recycleArmed === key;
          const text = t('recycle.value', { n: val.count, count: val.count, money: fmt(val.money), metal: fmt(val.metal) });
          out.push(btn(null, 'recycle', t(armed ? 'fleet.act.sure' : 'fleet.act.recycle'), ok ? t(armed ? 'recycle.confirm' : 'recycle.fleet') : t('recycle.cantAfford'),
            ` data-recycle="${key}" data-sfx="${armed ? 'none' : 'click'}"${armed ? ' data-armed="1"' : ''}${ok ? '' : ' disabled'}`));
          // The price of recycling is worth a line once it is about to happen.
          if (armed) info.push(`<span style="color:var(--gold)">${t('recycle.confirm')} ${text}</span>`);
        }
      }
    }
    if (!out.length) return '';
    return `<div class="fa-row">${out.join('')}</div>
      ${info.map(x => `<p class="small oneline fa-info">${x}</p>`).join('')}`;
  },

  cargoSection(f, where) {
    const c = cargoOf(f.ships);
    if (!c.capacity) return '';
    const own = where && where.owner === this.view.you;
    const here = own ? where.defenses || 0 : 0;
    const max = { load: Math.min(c.room, here), drop: c.used };
    if (this.cargoFleet !== f.id) { this.cargoFleet = f.id; this.cargoPick = { ...max }; }
    this.cargoMax = max;
    for (const k of ['load', 'drop']) this.cargoPick[k] = Math.max(Math.min(1, max[k]), Math.min(this.cargoPick[k], max[k]));
    const row = (k) => {
      const off = max[k] ? '' : ' disabled';
      return `
        <div class="buildrow">
          <span class="bq" style="margin-left:0">
            <button class="tiny" id="cq-${k}-minus"${off}>−</button>
            <span class="n" id="cq-${k}">${this.cargoPick[k]}</span>
            <button class="tiny" id="cq-${k}-plus"${off}>+</button>
          </span>
          <button class="tiny" id="cargo-${k}"${off}>${t('fleet.' + k)}</button>
          <span class="small muted">${t('fleet.' + k + 'Max', { n: max[k] })}</span>
        </div>`;
    };
    return `
      <div class="sec">
        <h4>${t('fleet.cargo')}</h4>
        <div class="small">${t('fleet.cargoValue', { used: c.used, capacity: c.capacity })}</div>
        <div class="meter"><i style="width:${c.used / c.capacity * 100}%;background:var(--gold)"></i></div>
        ${own ? `
        <p class="hint-line">${t('fleet.cargoHere', { n: here, count: here })}</p>
        ${row('load')}
        ${row('drop')}
        <p class="hint-line">${t('fleet.cargoHint')}</p>`
        : `<p class="hint-line">${t('fleet.cargoAway')}</p>`}
      </div>`;
  },

  wireCargo(box, f) {
    for (const k of ['load', 'drop']) {
      const n = box.querySelector('#cq-' + k);
      if (!n) continue;
      const step = (d) => {
        this.cargoPick[k] = Math.max(1, Math.min(this.cargoMax[k], this.cargoPick[k] + d));
        n.textContent = this.cargoPick[k];
      };
      box.querySelector(`#cq-${k}-minus`).onclick = () => step(-1);
      box.querySelector(`#cq-${k}-plus`).onclick = () => step(1);
      box.querySelector('#cargo-' + k).onclick = () =>
        this.app.send({ t: 'orders', [k]: { fleetId: f.id, count: this.cargoPick[k] } });
    }
  },

  /**
   * A fleet in orbit or incoming. For own fleets, firepower and hull are
   * shown; for foreign ones only which ships they are.
   */
  fleetRow(f, p) {
    const v = this.view;
    const pl = ownerOf(v, f.owner);
    const color = pl?.color || '#9fb0c8';
    const target = f.dest != null && f.dest !== p.id ? v.planets[f.dest] : null;
    const arriving = f.dest === p.id && f.at !== p.id;
    const turns = arriving ? this.eta(f, p) : null;
    let right, below = '';
    if (f.mine) {
      const hp = f.ships.reduce((a, s) => a + s.hp, 0), max = f.ships.reduce((a, s) => a + s.maxHp, 0);
      right = `${fmt1(f.stats.attack || 0)} ⚔ · ${fmt(hp)}/${fmt(max)} HP`;
      below = `<div class="meter"><i style="width:${max ? hp / max * 100 : 0}%;background:${hp / max > 0.5 ? 'var(--good)' : hp / max > 0.25 ? 'var(--gold)' : 'var(--bad)'}"></i></div>`;
    } else {
      right = `<span class="muted">${t('fleet.strengthUnknown')}</span>`;
    }
    const whither = arriving && Number.isFinite(turns) ? t('fleet.arrivesIn', { turns: t('word.turns', { n: turns, count: turns }) })
      : target ? `→ ${escapeHtml(target.name)}` : f.hole ? `→ ${t('hole.name')}` : f.chase ? `→ ${t('fleet.chasing')}` : '';
    return `<div class="fleetrow ${f.mine ? '' : 'foe'}" data-fleet="${f.id}">
      <div class="fr-top">
        <span class="dot" style="background:${color}"></span>
        <span class="fr-name">${f.mine ? t('fleet.own') : escapeHtml(pl?.name || '?')}</span>
        <span class="hp">${right}</span>
      </div>
      ${below}
      <div class="fr-sub"><span class="fr-comp">${this.composition(f, color)}</span><span>${whither}</span></div>
    </div>`;
  },

  /** Turns until a fleet reaches the world - the server names those of foreign fleets. */
  eta(f, p) {
    if (!f.mine) return f.eta ?? Infinity;
    const speed = f.stats?.speed || 0;
    return speed > 0 ? Math.max(1, Math.ceil(travelDistance(f, p, holeZone(this.view.galaxy)) / speed)) : Infinity;
  },

  /** Ship types of a fleet as small images with counts. */
  composition(f, color) {
    const per = {};
    for (const s of f.ships) per[s.type] = (per[s.type] || 0) + 1;
    return [...ALIEN_TYPES, ...SHIP_TYPES].filter(type => per[type]).map(type =>
      `<span class="comp" title="${per[type]}× ${t(`ship.${type}.name`)}"><span class="ci" data-t="${type}" data-c="${color}"></span>${per[type]}</span>`).join('');
  },

  /**
   * Can this fleet go there? Computed as on the server (shared functions from
   * shared/rules.js) so the UI does not offer something the server would
   * reject right away.
   * @returns {string|null} the reason, or null if it is possible
   */
  whyNot(f, target) {
    const v = this.view;
    if (!f.stats || f.stats.speed <= 0) return t('err.fleetImmobile');
    // Standing on a mouth: the jump through it is always possible (shared/rules.js).
    if (onMouth(f, target)) return null;
    const bases = v.planets.filter(q => suppliesMe(v, q.owner) && q.pop > 0.5);
    if (!bases.length) return t('err.outOfRange', { need: '∞', range: f.stats.range });
    const need = Math.round(supplyNeed(bases, f, target, holeZone(v.galaxy), portalsOf(v)));
    if (need > f.stats.range) {
      return t('err.outOfRange', { need, range: f.stats.range });
    }
    return null;
  },

  /**
   * Would this part of a fleet in flight still reach its course target - or,
   * without one, any own world? Null if so, otherwise why not. The same
   * rule as the server's splitStrands (movement.js).
   */
  partReach(f, ships, stats) {
    const v = this.view;
    const part = { ...f, ships, stats };
    const target = courseTarget(v, f);
    if (target) return this.whyNot(part, target);
    const bases = v.planets.filter(q => suppliesMe(v, q.owner) && q.pop > 0.5);
    let why = t('err.outOfRange', { need: '∞', range: stats.range });
    for (const b of bases) { const w = this.whyNot(part, b); if (!w) return null; why = w; }
    return why;
  },

  /**
   * "Fleet here" for the most recently selected own fleet. Applies to every
   * world - including your own: bringing fleets home is defense, and
   * inhabited own worlds are the stepping stones for range.
   * It is only hidden when the fleet is already there; if it is not
   * possible, the reason is shown below instead of a rejection after the click.
   */
  courseButton(p) {
    const f = this.view.fleets.find(x => x.id === this.lastFleetId);
    if (!this.lastFleetId || !f || !f.mine || f.at === p.id || f.hole === p.id) return '';
    const reason = this.whyNot(f, p);
    const button = `<button id="setcourse" class="primary"${reason ? ' disabled' : ''}>`
      + `${t(typeof p.id === 'string' ? 'hole.courseButton' : 'planet.courseButton', { n: f.ships.length })}</button>`;
    return `<div class="sel-actions">${button}</div>`
      + (reason ? `<p class="hint-line" style="color:var(--bad)">${t('fleet.cannotReach', { reason })}</p>` : '');
  },

  /**
   * Intercept this foreign fleet with the last own fleet - for touch, where
   * there is no right click. Only for a fleet in flight that we are at war
   * with, and only with an armed fleet of our own.
   */
  chaseButton(prey) {
    const v = this.view;
    const f = v.fleets.find(x => x.id === this.lastFleetId);
    if (v.spectator || v.interception === false || !f || !f.mine || prey.at != null || prey.allied) return '';
    if (!f.ships.some(s => s.attack > 0)) return `<p class="hint-line">${t('fleet.chaseNeedsArms')}</p>`;
    return `<div class="sel-actions"><button id="chase" class="primary">${t('fleet.chaseButton', { n: f.ships.length })}</button></div>`;
  },

  wireChase(box, prey) {
    const b = box.querySelector('#chase');
    if (b) b.onclick = () => this.app.orderChase(prey.id);
  },

  wireCourse(box, p) {
    const b = box.querySelector('#setcourse');
    if (b) b.onclick = () => this.app.order(p.id);
  }
};
