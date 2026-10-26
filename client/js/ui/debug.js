// Debug dialog for admins: start a test battle or play any sound effect
// without having to play towards it. Purely in the browser - the battle is
// rolled here with the server's combat rules, nothing goes over the wire.
// Opened from the admin panel or with Ctrl+Shift+D (also in a game).
import { SHIP_TYPES, shipStats, batteryStats, COMBAT_ROUNDS, PLAYER_COLORS } from '../../shared/rules.js';
import { openBattle } from './battle.js';
import { sfx, SFX_NAMES } from '../audio/sfx.js';
import { t, onLocaleChange } from '../i18n.js';

// Satellites cannot fly - only the defender has them, around the world.
const ATTACKER_TYPES = SHIP_TYPES.filter(s => s !== 'satellite');
const DEFAULTS = {
  a: { fighter: 8, scout: 1, colony: 1 },
  b: { fighter: 4, satellite: 3 },
  techA: 1, techB: 1, pop: 3
};
const round1 = v => Math.round(v * 10) / 10;

export class DebugDialog {
  constructor() {
    this.enabled = false;
    this.cfg = structuredClone(DEFAULTS);
    this.modal = null;
    addEventListener('keydown', (e) => {
      if (!this.enabled || !(e.ctrlKey && e.shiftKey && e.code === 'KeyD')) return;
      e.preventDefault();
      this.toggle();
    });
    onLocaleChange(() => { if (this.modal) this.render(); });
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) this.modal?.classList.add('hidden');
  }

  toggle(show = this.modal?.classList.contains('hidden') ?? true) {
    if (!this.enabled) return;
    if (!this.modal) this.build();
    this.modal.classList.toggle('hidden', !show);
  }

  build() {
    this.modal = document.createElement('div');
    this.modal.id = 'debug';
    this.modal.className = 'modal hidden';
    document.body.appendChild(this.modal);
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) return this.toggle(false);
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'close') this.toggle(false);
      if (a === 'reset') { this.cfg = structuredClone(DEFAULTS); this.render(); }
      if (a === 'fight') this.fight();
      const snd = e.target.closest('[data-play]');
      if (snd) sfx.play(snd.dataset.play);
    });
    this.modal.addEventListener('input', (e) => {
      const f = e.target.dataset.f;
      if (!f) return;
      const v = Math.max(0, +e.target.value || 0);
      const [side, type] = f.split('.');
      if (type) this.cfg[side][type] = v;
      else this.cfg[side] = v;
    });
    this.modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.toggle(false); }
    });
    this.render();
  }

  render() {
    const c = this.cfg;
    const num = (f, v, max = 60) => `<input type="number" min="0" max="${max}" data-f="${f}" value="${v ?? 0}">`;
    const rows = SHIP_TYPES.map(type => `<tr>
      <th>${t(`ship.${type}.name`)}</th>
      <td>${ATTACKER_TYPES.includes(type) ? num(`a.${type}`, c.a[type]) : '–'}</td>
      <td>${num(`b.${type}`, c.b[type])}</td>
    </tr>`).join('');
    this.modal.innerHTML = `<div class="modal-box debug-box">
      <h2>${t('debug.title')}</h2>
      <h3>${t('debug.battle')}</h3>
      <table class="debug-grid">
        <thead><tr><th></th>
          <th><span class="bt-dot" style="background:${PLAYER_COLORS[1]}"></span> ${t('debug.attacker')}</th>
          <th><span class="bt-dot" style="background:${PLAYER_COLORS[0]}"></span> ${t('debug.defender')}</th></tr></thead>
        <tbody>${rows}
          <tr><th>${t('debug.tech')}</th><td>${num('techA', c.techA, 40)}</td><td>${num('techB', c.techB, 40)}</td></tr>
          <tr><th>${t('debug.pop')}</th><td>–</td><td>${num('pop', c.pop, 30)}</td></tr>
        </tbody>
      </table>
      <p class="muted small">${t('debug.battleHint')}</p>
      <div class="debug-actions">
        <button type="button" class="tiny" data-a="reset">${t('debug.reset')}</button>
        <button type="button" class="primary" data-a="fight">${t('debug.fight')}</button>
      </div>
      <h3>${t('debug.sounds')}</h3>
      <div class="debug-sounds">${SFX_NAMES.map(n =>
        `<button type="button" class="tiny" data-play="${n}" data-sfx="none">${n}</button>`).join('')}</div>
      <div class="debug-actions">
        <button type="button" class="primary" data-a="close">${t('battle.close')}</button>
      </div>
    </div>`;
  }

  fight() {
    const players = [
      { id: 'dbg-a', name: t('debug.attacker'), color: PLAYER_COLORS[1] },
      { id: 'dbg-b', name: t('debug.defender'), color: PLAYER_COLORS[0] }
    ];
    const battle = simulate(this.cfg);
    if (!battle) { sfx.play('deny'); return; }
    this.toggle(false);
    openBattle({
      battle, players, you: 'dbg-a',
      planet: { id: 'debug', name: 'Debugia', temp: 18, grav: 1, owner: 'dbg-b', pop: this.cfg.pop }
    });
  }
}

/**
 * The same battle the server would fight (server/game.js resolveCombatAt),
 * without fleets, cargo and interception - just the record for the replay.
 * Side 0 attacks, side 1 owns the world.
 */
function simulate(cfg) {
  const sides = [[], []];
  const add = (k, type, tech) => {
    const s = shipStats(type, { weapons: tech, shields: tech });
    sides[k].push({ type, attack: s.attack, hp: s.maxHp, maxHp: s.maxHp });
  };
  for (const type of ATTACKER_TYPES) for (let i = 0; i < (cfg.a[type] || 0); i++) add(0, type, cfg.techA || 1);
  for (const type of SHIP_TYPES) for (let i = 0; i < (cfg.b[type] || 0); i++) add(1, type, cfg.techB || 1);
  const bs = batteryStats(cfg.pop, { weapons: cfg.techB || 1, shields: cfg.techB || 1 });
  if (bs) sides[1].push({ type: 'battery', attack: bs.attack, hp: bs.hp, maxHp: bs.hp, isBattery: true });
  if (!sides[0].length || !sides[1].length) return null;
  if (!sides.flat().some(s => s.attack > 0)) return null;

  const units = [], idx = new Map();
  sides.forEach((ships, k) => ships.forEach(s => { idx.set(s, units.length); units.push([k, s.type, s.hp, round1(s.maxHp)]); }));
  const rounds = [];
  for (let r = 0; r < COMBAT_ROUNDS; r++) {
    const alive = sides.map((ships, k) => [k, ships.filter(s => s.hp > 0)]).filter(([, s]) => s.length);
    if (alive.length < 2) break;
    const damage = [];
    for (const [k, ships] of alive) {
      const enemies = alive.filter(([o]) => o !== k).flatMap(([, s]) => s);
      for (const s of ships) {
        if (s.attack <= 0) continue;
        const target = enemies[Math.floor(Math.random() * enemies.length)];
        damage.push([target, round1(s.attack * (0.75 + Math.random() * 0.5)), s]);
      }
    }
    rounds.push(damage.map(([to, dmg, s]) => [idx.get(s), idx.get(to), dmg]));
    for (const [to, dmg] of damage) to.hp = Math.max(0, round1(to.hp - dmg));
  }
  // Whoever still has weapons controls the orbit; the attacker's defenseless
  // ships are given up. The defender's satellites are no fleet and stay.
  const armed = sides.map(ships => ships.some(s => s.hp > 0 && s.attack > 0));
  const scuttled = armed[1] && !armed[0] ? sides[0].filter(s => s.hp > 0).map(s => idx.get(s))
    : armed[0] && !armed[1] ? sides[1].filter(s => s.hp > 0 && !s.isBattery && s.type !== 'satellite').map(s => idx.get(s))
    : [];
  return { sides: ['dbg-a', 'dbg-b'], units, rounds, scuttled, fled: [] };
}
