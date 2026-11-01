// The empire tab: the own worlds, with what terraforming does for them.
import {
  terraformable, terraformFullCost, IDEAL, planetCapacity, planetIncome, planetMining
} from '../../../shared/rules.js';
import { localeTag, t } from '../../i18n.js';
import { fmt, fmt1 } from './format.js';

const $ = s => document.querySelector(s);

export const empireMethods = {
  /**
   * Tooltip for a terraforming world in the world list: budget, what is
   * still missing and what it brings - same numbers as the planet panel.
   * @returns {string} HTML for showTip
   */
  terraTip(p, me) {
    const radical = me?.tech?.radical ?? 1;
    const allow = terraformable(p, radical);
    const rest = terraformFullCost(p, radical);
    const goal = { ...p, temp: allow.temp ? IDEAL.temp : p.temp, grav: allow.grav ? IDEAL.grav : p.grav };
    const cap = planetCapacity(p), capGoal = planetCapacity(goal);
    const turns = Math.ceil(rest / p.terraBudget);
    const grav = g => g.toLocaleString(localeTag(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const row = (k, v) => `<span class="k">${k}</span><span class="v">${v}</span>`;
    return `
      <div class="tip-title">${p.name}</div>
      <div class="tip-sub">${t('terra.tipTitle')}</div>
      <div class="tip-grid">
        ${row(t('terra.tipBudget'), t('terra.tipPerTurn', { budget: fmt(p.terraBudget) }))}
        ${row(t('terra.tipEta'), rest ? t('terra.tipTurns', { n: turns, count: turns }) : t('terra.tipIdle'))}
        ${row(t('terra.tipRest'), `${fmt(rest)} ${t('unit.cr')}`)}
        ${row(t('terra.tipSpent'), `${fmt(p.terraSpent || 0)} ${t('unit.cr')}`)}
        ${row(t('planet.temp'), `${fmt1(p.temp)} → ${fmt1(goal.temp)} °C`)}
        ${row(t('planet.grav'), `${grav(p.grav)} → ${grav(goal.grav)} g`)}
        ${row(t('terra.tipCap'), `${cap} → ${capGoal} ${t('unit.mio')}${capGoal > cap ? ` <b class="good">+${capGoal - cap}</b>` : ''}`)}
      </div>
      ${!allow.temp || !allow.grav ? `<div class="tip-warn">${t('terra.tipBlocked', { level: radical })}</div>` : ''}`;
  },

  empire() {
    const v = this.view;
    const mine = v.planets.filter(p => p.owner === v.you)
      .sort((a, b) => b.pop - a.pop);
    const box = $('#tab-empire');
    const income = mine.reduce((a, p) => a + planetIncome(p), 0);
    const mining = mine.reduce((a, p) => a + planetMining(p), 0);
    box.innerHTML = `
      <div class="statgrid">
        <div class="stat"><div class="k">${t('empire.income')}</div><div class="v">+${fmt(income)}</div></div>
        <div class="stat"><div class="k">${t('empire.mining')}</div><div class="v">+${fmt(mining)}</div></div>
      </div>
      <h4 style="font-size:12.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-dim);margin:10px 0 6px">${t('empire.worlds', { n: mine.length })}</h4>
      ${mine.map(p => `<div class="listrow" data-p="${p.id}"${p.terraBudget ? ' data-tip' : ''}>
        <span class="dot" style="background:${tempHex(p.temp)}"></span>
        <span class="nm">${p.name}${p.terraBudget
          ? ` <span class="muted small">⚙ ${t('terra.tipPerTurn', { budget: fmt(p.terraBudget) })}</span>` : ''}</span>
        <span class="num">${t('planet.popValue', { pop: fmt1(p.pop), cap: planetCapacity(p) })}</span>
      </div>`).join('') || `<p class="muted small">${t('empire.noColonies')}</p>`}
      <h4 style="font-size:12.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-dim);margin:14px 0 6px">${t('empire.fleets')}</h4>
      ${v.fleets.filter(f => f.mine).map(f => {
        const where = f.at != null ? t('empire.inOrbitOf', { planet: v.planets[f.at].name })
          : f.dest != null ? t('empire.enRouteTo', { planet: v.planets[f.dest].name })
          : f.hole ? t('empire.toHole')
          : t('fleet.enRoute');
        return `<div class="listrow" data-f="${f.id}">
          <span class="dot" style="background:${v.me.color}"></span>
          <span class="nm">${t('word.ships', { n: f.ships.length, count: f.ships.length })} · ${where}</span>
          <span class="num">${f.stats.attack || 0}⚔</span>
        </div>`;
      }).join('') || `<p class="muted small">${t('empire.noFleets')}</p>`}
    `;
    this.wireTips(box, row => this.terraTip(v.planets[+row.dataset.p], v.me));
    for (const row of box.querySelectorAll('[data-p]')) {
      row.onclick = () => {
        const p = v.planets[+row.dataset.p];
        this.app.map.focus(p, this.app.freeArea());
        this.app.setSelection({ type: 'planet', id: p.id });
      };
    }
    for (const row of box.querySelectorAll('[data-f]')) {
      row.onclick = () => {
        const f = v.fleets.find(x => x.id === row.dataset.f);
        this.app.map.focus(f.at != null ? v.planets[f.at] : f, this.app.freeArea());
        this.app.setSelection({ type: 'fleet', id: f.id });
      };
    }
  }
};

function tempHex(t) {
  const c = [
    [-180, [92, 108, 196]], [-90, [72, 168, 228]], [-30, [92, 212, 206]],
    [20, [96, 206, 108]], [70, [224, 206, 86]], [130, [232, 142, 58]], [220, [206, 62, 58]]
  ];
  for (let i = 1; i < c.length; i++) {
    if (t <= c[i][0]) {
      const [t0, a] = c[i - 1], [t1, b] = c[i];
      const f = Math.max(0, (t - t0) / (t1 - t0));
      return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
    }
  }
  return 'rgb(206,62,58)';
}
