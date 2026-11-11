// Debug dialog of the dev mode (HO_DEV on the server; admins, or everyone
// without sign-in): start a test battle or play any sound effect without
// having to play towards it - purely in the browser, the battle is rolled
// here with the server's combat rules. In a running game it also steps in:
// opening and closing wormholes, a destroyer and aliens right away - that
// does go to the server. And it plays the radio chatter of the AI colonies
// and the aliens, clip by clip. And it shows the fighters as they look with
// any tech (render/fighterlook.js): in the profile right away, or as a
// fleet in the running game.
// Opened with Ctrl+Shift+D, in the start menu as in a game.
import { SHIP_TYPES, shipStats, batteryStats, COMBAT_ROUNDS, PLAYER_COLORS } from '../../shared/rules.js';
import { openBattle } from './battle.js';
import { openShipInfo } from './shipinfo.js';
import { fighterLook, MARK } from '../render/fighterlook.js';
import { sfx, SFX_NAMES } from '../audio/sfx.js';
import { radio } from '../audio/radio.js';
import { t, hasKey, onLocaleChange } from '../i18n.js';

// Satellites cannot fly - only the defender has them, around the world.
const ATTACKER_TYPES = SHIP_TYPES.filter(s => s !== 'satellite');
const DEFAULTS = {
  a: { fighter: 8, scout: 1, colony: 1 },
  b: { fighter: 4, satellite: 3 },
  techA: 1, techB: 1, pop: 3,
  fighter: { weapons: 3, shields: 3, speed: 2, range: 2 }
};
// The research fields a fighter's look depends on, and examples for it -
// the same as in the design preview.
const FIGHTER_FIELDS = ['weapons', 'shields', 'speed', 'range'];
const FIGHTER_PRESETS = [
  ['start', { weapons: 3, shields: 3, speed: 2, range: 2 }],
  ['glass', { weapons: 26, shields: 4, speed: 18, range: 5 }],
  ['armour', { weapons: 12, shields: 34, speed: 8, range: 6 }],
  ['racer', { weapons: 8, shields: 10, speed: 36, range: 24 }],
  ['long', { weapons: 14, shields: 14, speed: 16, range: 38 }],
  ['late', { weapons: 30, shields: 28, speed: 26, range: 22 }],
  ['max', { weapons: 40, shields: 40, speed: 40, range: 40 }]
];
const clampLevel = v => Math.max(1, Math.min(40, Math.round(+v) || 1));
const round1 = v => Math.round(v * 10) / 10;

export class DebugDialog {
  constructor() {
    this.enabled = false;
    this.app = null;            // set in dev mode: the game it may step into
    this.cfg = structuredClone(DEFAULTS);
    this.modal = null;
    // What is being said shows in the dialog - the subtitle.
    radio.onLine(({ speaker, clip }) => {
      const el = this.modal?.querySelector('[data-out="radio"]');
      if (el) el.textContent = `${speaker}: ${clip.text}`;
    });
    addEventListener('keydown', (e) => {
      if (!this.enabled || !(e.ctrlKey && e.shiftKey && e.code === 'KeyD')) return;
      e.preventDefault();
      this.toggle();
    });
    onLocaleChange(() => { if (this.modal) this.render(); });
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) { this.modal?.classList.add('hidden'); radio.stop(); }
  }

  /** Dev mode: the app whose game the wormhole tools act on, or null. */
  setDev(app) {
    this.app = app;
  }

  toggle(show = this.modal?.classList.contains('hidden') ?? true) {
    if (!this.enabled) return;
    if (!this.modal) this.build();
    else if (show) this.render();        // the game may have started meanwhile
    this.modal.classList.toggle('hidden', !show);
    if (!show) radio.stop();
  }

  /** One row of buttons per speaker, once the clip list is there. */
  async fillRadio() {
    const m = await radio.load();
    const el = this.modal?.querySelector('.debug-radio');
    if (!el) return;
    // Crew and shipyard have several voices with the same lines - the first stands for all.
    const rows = Object.entries(m).filter(([speaker]) => !/^(crew|yard)[2-9]/.test(speaker)).map(([speaker, events]) => `<div class="debug-radio-row">
      <span>${speaker === 'alien' ? t('alien.name') : hasKey(`persona.${speaker}`) ? t(`persona.${speaker}`) : speaker}</span>
      <div class="debug-sounds">${Object.entries(events).flatMap(([event, clips]) => clips.map((c, n) =>
        `<button type="button" class="tiny" data-radio="${speaker}/${event}/${n}" data-sfx="none" title="${c.text.replace(/"/g, '&quot;')}">${event} ${n + 1}</button>`)).join('')}</div>
    </div>`).join('');
    el.innerHTML = rows || `<p class="muted small">${t('debug.radioNone')}</p>`;
  }

  /** Where the selection on the map is - a wormhole may open next to it. */
  selectionPoint() {
    const sel = this.app?.selection, v = this.app?.map?.view;
    if (!sel || !v) return null;
    const it = sel.type === 'planet' ? v.planets[sel.id]
      : sel.type === 'hole' ? v.wormholes?.find(m => m.id === sel.id)
      : v.fleets.find(f => f.id === sel.id);
    return it ? { x: it.x, y: it.y, z: it.z || 0 } : null;
  }

  /** The selected world, or the one the selected fleet orbits - null otherwise. */
  selectedPlanet() {
    const sel = this.app?.selection;
    return sel?.type === 'planet' ? sel.id
      : sel?.type === 'fleet' ? this.app.map?.view?.fleets.find(f => f.id === sel.id)?.at ?? null : null;
  }

  /**
   * A destroyer or a ready station at the selected own world - the server
   * takes the homeworld otherwise.
   */
  destroyer(action = 'destroyer') {
    this.app.send({ t: 'dev', action, planetId: this.selectedPlanet() });
    this.toggle(false);
  }

  /** The fighter tech set in the dialog, every field 1-40. */
  fighterTech() {
    return Object.fromEntries(FIGHTER_FIELDS.map(f => [f, clampLevel(this.cfg.fighter[f])]));
  }

  /** "Mk II" and the steps of the fields, next to the inputs. */
  fighterInfo() {
    const l = fighterLook(this.fighterTech());
    return `Mk ${MARK[l.gen]} · ${FIGHTER_FIELDS.map((f, i) => `${t(`tech.${f}.short`)} ${[l.w, l.s, l.v, l.r][i] + 1}/4`).join(' · ')}`;
  }

  /**
   * Fighters with these techs into the running game: a fleet at the
   * selected own world, otherwise at the homeworld.
   */
  fighters(techs) {
    this.app.send({ t: 'dev', action: 'fighters', planetId: this.selectedPlanet(), techs });
    this.toggle(false);
  }

  /** Aliens at the selected world - without a selection the server picks one of the player's. */
  aliens() {
    const sel = this.app?.selection;
    const planetId = sel?.type === 'planet' ? sel.id
      : sel?.type === 'fleet' ? this.app.map?.view?.fleets.find(f => f.id === sel.id)?.at ?? null : null;
    this.app.send({ t: 'dev', action: 'aliens', planetId });
    this.toggle(false);
  }

  hole(action) {
    const at = action === 'openHere' ? this.selectionPoint() : null;
    if (action === 'openHere' && !at) { sfx.play('deny'); return; }
    this.app.send({ t: 'dev', action: action === 'openHere' ? 'open' : action, at });
    this.toggle(false);
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
      if (a === 'destroyer') this.destroyer();
      if (a === 'station') this.destroyer('station');
      if (a === 'aliens') this.aliens();
      if (a === 'fighterView') {
        openShipInfo('fighter', { tech: this.fighterTech(), color: this.app?.map?.view?.me?.color, types: ['fighter'] });
      }
      if (a === 'fighterGet') this.fighters([this.fighterTech()]);
      if (a === 'fighterAll') this.fighters(FIGHTER_PRESETS.map(([, tech]) => tech));
      const pre = e.target.closest('[data-fpreset]')?.dataset.fpreset;
      if (pre != null) {
        this.cfg.fighter = { ...FIGHTER_PRESETS[+pre][1] };
        for (const f of FIGHTER_FIELDS) {
          const el = this.modal.querySelector(`[data-f="fighter.${f}"]`);
          if (el) el.value = this.cfg.fighter[f];
        }
        this.modal.querySelector('[data-out="mk"]').textContent = this.fighterInfo();
      }
      if (a === 'radioNamed') { this.app.send({ t: 'dev', action: 'radio' }); this.toggle(false); }
      const hole = e.target.closest('[data-hole]')?.dataset.hole;
      if (hole) this.hole(hole);
      const snd = e.target.closest('[data-play]');
      if (snd) sfx.play(snd.dataset.play);
      const rad = e.target.closest('[data-radio]')?.dataset.radio;
      if (rad) {
        const [speaker, event, n] = rad.split('/');
        radio.stop();
        radio.say(speaker, event, +n).then(ok => { if (!ok) sfx.play('deny'); });
      }
      if (a === 'radioStop') radio.stop();
    });
    this.modal.addEventListener('input', (e) => {
      const f = e.target.dataset.f;
      if (!f) return;
      const v = Math.max(0, +e.target.value || 0);
      const [side, type] = f.split('.');
      if (type) this.cfg[side][type] = v;
      else this.cfg[side] = v;
      if (side === 'fighter') this.modal.querySelector('[data-out="mk"]').textContent = this.fighterInfo();
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
    // Wormhole tools only in dev mode and only in a running game.
    const running = this.app?.map?.view?.state === 'running';
    const holes = !this.app ? '' : `
      <h3>${t('dev.holes')}</h3>
      ${running ? `<div class="debug-actions debug-dev">
        ${['open', 'openHere', 'reveal', 'shake', 'close'].map(a =>
          `<button type="button" class="tiny" data-hole="${a}"${a === 'openHere' && !this.selectionPoint() ? ' disabled' : ''}>${t(`dev.hole.${a}`)}</button>`).join('')}
      </div>
      <p class="muted small">${t('dev.holesHint')}</p>` : `<p class="muted small">${t('dev.inGame')}</p>`}
      ${running && !this.app.map.view.spectator && this.app.map.view.capitalShips !== false ? `<h3>${t('dev.ships')}</h3>
      <div class="debug-actions debug-dev">
        <button type="button" class="tiny" data-a="destroyer">${t('dev.destroyer')}</button>
        <button type="button" class="tiny" data-a="station">${t('dev.station')}</button>
      </div>
      <p class="muted small">${t('dev.destroyerHint')}</p>
      <p class="muted small">${t('dev.stationHint')}</p>` : ''}
      ${running ? `<h3>${t('alien.name')}</h3>
      <div class="debug-actions debug-dev">
        <button type="button" class="tiny" data-a="aliens">${t('dev.aliens')}</button>
      </div>
      <p class="muted small">${t('dev.aliensHint')}</p>` : ''}
      ${running && !this.app.map.view.spectator ? `<h3>${t('debug.radio')}</h3>
      <div class="debug-actions debug-dev">
        <button type="button" class="tiny" data-a="radioNamed">${t('dev.radioNamed')}</button>
      </div>
      <p class="muted small">${t('dev.radioNamedHint')}</p>` : ''}`;
    this.modal.innerHTML = `<div class="modal-box debug-box">
      <h2>${t('debug.title')}</h2>${holes}
      ${this.fighterSection(running)}
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
      <h3>${t('debug.radio')}</h3>
      <div class="debug-radio"></div>
      <p class="small" data-out="radio"></p>
      <p class="muted small">${t('debug.radioHint')}</p>
      <div class="debug-actions">
        <button type="button" class="tiny" data-a="radioStop" data-sfx="none">${t('debug.radioStop')}</button>
      </div>
      <div class="debug-actions">
        <button type="button" class="primary" data-a="close">${t('battle.close')}</button>
      </div>
    </div>`;
    this.fillRadio();
  }

  /** Fighters by tech: four levels, examples, the profile - and in a game the ships themselves. */
  fighterSection(running) {
    const c = this.cfg.fighter;
    const game = running && !this.app.map.view.spectator;
    return `<h3>${t('dev.fighters')}</h3>
      <table class="debug-grid"><tbody>
        ${FIGHTER_FIELDS.map(f => `<tr><th>${t(`tech.${f}.name`)}</th>
          <td><input type="number" min="1" max="40" data-f="fighter.${f}" value="${c[f]}"></td></tr>`).join('')}
      </tbody></table>
      <p class="small" data-out="mk">${this.fighterInfo()}</p>
      <div class="debug-actions debug-dev">${FIGHTER_PRESETS.map(([k], i) =>
        `<button type="button" class="tiny" data-fpreset="${i}">${t(`dev.fighterPreset.${k}`)}</button>`).join('')}</div>
      <div class="debug-actions debug-dev">
        <button type="button" class="tiny" data-a="fighterView">${t('dev.fighterView')}</button>
        ${game ? `<button type="button" class="tiny" data-a="fighterGet">${t('dev.fighterGet')}</button>
        <button type="button" class="tiny" data-a="fighterAll">${t('dev.fighterAll')}</button>` : ''}
      </div>
      <p class="muted small">${t(game ? 'dev.fightersHint' : 'dev.fightersHintMenu')}</p>`;
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
    sides[k].push({ type, attack: s.attack, hp: s.maxHp, maxHp: s.maxHp, guns: s.guns, weight: s.weight });
  };
  for (const type of ATTACKER_TYPES) for (let i = 0; i < (cfg.a[type] || 0); i++) add(0, type, cfg.techA || 1);
  for (const type of SHIP_TYPES) for (let i = 0; i < (cfg.b[type] || 0); i++) add(1, type, cfg.techB || 1);
  const bs = batteryStats(cfg.pop, { weapons: cfg.techB || 1, shields: cfg.techB || 1 });
  if (bs) sides[1].push({ type: 'battery', attack: bs.attack, hp: bs.hp, maxHp: bs.hp, isBattery: true });
  if (!sides[0].length || !sides[1].length) return null;
  if (!sides.flat().some(s => s.attack > 0)) return null;

  const units = [], idx = new Map();
  // Fighters carry their tech like on the server - at this level in every field.
  sides.forEach((ships, k) => ships.forEach(s => {
    idx.set(s, units.length);
    const lv = k ? cfg.techB || 1 : cfg.techA || 1;
    units.push([k, s.type, s.hp, round1(s.maxHp), ...(s.type === 'fighter' ? [[lv, lv, lv, lv]] : [])]);
  }));
  const rounds = [];
  for (let r = 0; r < COMBAT_ROUNDS; r++) {
    const alive = sides.map((ships, k) => [k, ships.filter(s => s.hp > 0)]).filter(([, s]) => s.length);
    if (alive.length < 2) break;
    const damage = [];
    for (const [k, ships] of alive) {
      const enemies = alive.filter(([o]) => o !== k).flatMap(([, s]) => s);
      const total = enemies.reduce((a, e) => a + (e.weight || 1), 0);
      for (const s of ships) {
        if (s.attack <= 0) continue;
        // Several guns each pick a target; big ships are picked more often.
        const guns = s.guns || 1;
        for (let g = 0; g < guns; g++) {
          let x = Math.random() * total, target = enemies[enemies.length - 1];
          for (const e of enemies) if ((x -= e.weight || 1) < 0) { target = e; break; }
          damage.push([target, round1(s.attack / guns * (0.75 + Math.random() * 0.5)), s]);
        }
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
