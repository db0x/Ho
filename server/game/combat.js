// Battles in orbit: who fights whom, the combat rounds with the record for
// the replay, intercepting fleets that try to leave, the planetary defense
// battery - and the repairs a destroyer makes afterwards.
import {
  SHIP_DEFS, REPAIR_SHARE, batteryStats, COMBAT_ROUNDS, INTERCEPT_ROUNDS, isAlien
} from '../../shared/rules.js';
import { hostile } from './diplomacy.js';
import { cleanupFleets } from './fleets.js';
import { repairStations } from './shipyard.js';
import { planetById, playerById } from './game.js';
import { nearestName } from './movement.js';

/**
 * Every world with strangers in orbit sees a battle. Whoever departs while
 * an armed enemy is in orbit gets intercepted (see below), then the
 * destroyers repair their fleets where nobody fought.
 * Fleets that caught each other in open space fight where they met.
 * @param {{at: object, fleets: object[]}[]} encounters  from moveFleets
 * @returns {Set<number>} the worlds with a battle this turn
 */
export function fightBattles(game, departures, entries, encounters = []) {
  const rng = game.rng;
  const fought = new Set();          // worlds with a battle this turn - no repairs there
  // 5) Combat. Whoever departs while an armed enemy is in orbit gets
  // intercepted: they still have to survive INTERCEPT_ROUNDS combat rounds,
  // then they are gone. Otherwise every scout would escape, since all moves happen simultaneously.
  for (const planet of game.galaxy.planets) {
    const fleeing = departures
      .filter(([f, from]) => from === planet.id && f.ships.length && game.fleets.some(g =>
        g.at === planet.id && hostile(game, g.owner, f.owner) && g.ships.some(s => s.attack > 0)))
      .map(([f]) => f);
    if (resolveCombatAt(game, planet, entries, rng, fleeing)) fought.add(planet.id);
  }
  // In open space: no world, no battery, no satellites - only the fleets.
  for (const e of encounters) {
    const group = e.fleets.filter(f => f.ships.length && f.at == null);
    if (group.length < 2) continue;
    const site = { id: null, name: nearestName(game, e.at), owner: null, pop: 0, defenses: null, at: e.at };
    resolveCombatAt(game, site, entries, rng, [], group);
  }
  cleanupFleets(game);
  // Whoever chased a fleet that is gone now has nothing left to chase.
  const left = new Set(game.fleets.map(f => f.id));
  for (const f of game.fleets) if (f.chase && !left.has(f.chase)) { f.chase = null; f.aim = null; }
  repairFleets(game, fought, entries);
  repairStations(game, fought);
  return fought;
}

// Numbers go out unformatted - how they are written (comma or period) is
// up to the client's language.
export function round1(n) { return Math.round(n * 10) / 10; }

const gunsOf = s => SHIP_DEFS[s.type]?.guns || 1;
/** Big ships draw the fire: picked as often as `weight` small ones. */
const targetWeight = s => SHIP_DEFS[s.type]?.weight || 1;

/**
 * A target by weight. With equal weights exactly the same pick as
 * enemies[Math.floor(r * n)] - existing battles roll the same as before.
 */
function pickTarget(enemies, weights, total, r) {
  let x = r * total;
  for (let i = 0; i < enemies.length; i++) {
    x -= weights[i];
    if (x < 0) return enemies[i];
  }
  return enemies[enemies.length - 1];
}

/**
 * Repairs in the orbit of own worlds: a fleet with a destroyer gets back a
 * share of every ship's hull - but not in a turn with a battle there.
 */
function repairFleets(game, fought, entries) {
  for (const f of game.fleets) {
    if (f.at == null || fought.has(f.at) || !f.ships.some(s => SHIP_DEFS[s.type]?.repair)) continue;
    const planet = planetById(game, f.at);
    if (!planet || planet.owner !== f.owner) continue;
    let mended = 0;
    for (const s of f.ships) {
      if (s.hp >= s.maxHp) continue;
      s.hp = Math.min(s.maxHp, round1(s.hp + s.maxHp * REPAIR_SHARE));
      mended++;
    }
    if (mended) entries.push({ type: 'build', playerIds: [f.owner], private: f.owner, planetId: planet.id,
      key: 'log.repaired', params: { planet: planet.name, count: mended } });
  }
}

/**
 * A battle at a world - or, with `group`, between these fleets in open
 * space (`planet` is then only the spot: no owner, no defenses).
 * @returns {boolean} whether there was a battle
 */
function resolveCombatAt(game, planet, entries, rng, fleeing = [], group = null) {
  const sides = new Map();
  let battery = null;
  const here = group ? (f => group.includes(f)) : (f => f.at === planet.id);
  for (const f of game.fleets) {
    if (!here(f) || !f.ships.length) continue;
    if (!sides.has(f.owner)) sides.set(f.owner, []);
    sides.get(f.owner).push(...f.ships);
  }
  // Intercepted ships only fight during the first INTERCEPT_ROUNDS rounds
  const escaping = new Set();
  for (const f of fleeing) {
    if (!sides.has(f.owner)) sides.set(f.owner, []);
    sides.get(f.owner).push(...f.ships);
    for (const s of f.ships) escaping.add(s);
  }
  if (planet.owner && planet.defenses && planet.defenses.length) {
    if (!sides.has(planet.owner)) sides.set(planet.owner, []);
    sides.get(planet.owner).push(...planet.defenses);
  }
  // The orbital station fights along; under construction it is only a target.
  const station = planet.owner ? planet.station : null;
  if (station) {
    if (!sides.has(planet.owner)) sides.set(planet.owner, []);
    sides.get(planet.owner).push(station);
  }
  // Only fight if there is any stranger in orbit at all - allies of the
  // owner are guests, not strangers.
  const intruder = [...sides.keys()].some(o => o !== planet.owner && (!planet.owner || hostile(game, o, planet.owner)));
  if (!intruder) return false;
  if (planet.owner) {
    const ownerP = playerById(game, planet.owner);
    const bs = ownerP ? batteryStats(planet.pop, ownerP.tech) : null;
    if (bs) {
      battery = { id: 'battery', type: 'battery', attack: bs.attack, hp: bs.hp, maxHp: bs.hp, isBattery: true };
      if (!sides.has(planet.owner)) sides.set(planet.owner, []);
      sides.get(planet.owner).push(battery);
    }
  }
  // A battle needs two sides that are at war - and someone with weapons.
  const foes = (owner, among) => among.filter(([o]) => hostile(game, o, owner));
  const all = [...sides];
  if (!all.some(([o]) => foes(o, all).length)) return false;
  const anyArmed = all.some(([o, ships]) => ships.some(s => s.attack > 0 && !(s.building > 0)) && foes(o, all).length);
  if (!anyArmed) return false;

  const before = new Map([...sides].map(([k, v]) => [k, v.length]));

  // Record for the replay in the client: every unit once, every shot as
  // [shooter, target, damage]. Compact, because it travels with the view.
  // A unit is [side, type, hp, maxHp] - a fighter adds [weapons, shields, speed, range].
  const owners = [...sides.keys()];
  const units = [];
  const idx = new Map();
  owners.forEach((owner, k) => {
    for (const s of sides.get(owner)) {
      idx.set(s, units.length);
      const unit = [k, s.isBattery ? 'battery' : s === station && s.building > 0 ? 'stationSite' : s.type, s.hp, round1(s.maxHp)];
      // A fighter's look follows the tech it was built with (client fighterlook.js).
      if (s.type === 'fighter' && s.tech) unit.push([s.tech.weapons, s.tech.shields, s.tech.speed, s.tech.range]);
      units.push(unit);
    }
  });
  const rounds = [];

  for (let round = 0; round < COMBAT_ROUNDS; round++) {
    const engaged = s => s.hp > 0 && (round < INTERCEPT_ROUNDS || !escaping.has(s));
    const alive = [...sides].filter(([, ships]) => ships.some(engaged));
    if (!alive.some(([o]) => foes(o, alive).length)) break;
    const damage = [];
    for (const [owner, ships] of alive) {
      // Allies fight side by side: they only shoot at their enemies.
      const enemies = foes(owner, alive).flatMap(([, s]) => s.filter(engaged));
      if (!enemies.length) continue;
      const weights = enemies.map(targetWeight);
      const total = weights.reduce((a, w) => a + w, 0);
      for (const s of ships) {
        if (!engaged(s) || s.attack <= 0 || s.building > 0) continue;
        // Big ships fire several guns, each at a target of its own.
        const guns = gunsOf(s);
        for (let g = 0; g < guns; g++) {
          const t = pickTarget(enemies, weights, total, rng());
          // Rounded to tenths - exactly as it appears in the record.
          damage.push([t, round1(s.attack / guns * (0.75 + rng() * 0.5)), s]);
        }
      }
    }
    rounds.push(damage.map(([t, dmg, s]) => [idx.get(s), idx.get(t), dmg]));
    // To tenths, like the damage: otherwise a remainder like 2e-15 would be
    // left after subtracting, and a ship without a hull would fly on.
    for (const [t, dmg] of damage) t.hp = round1(t.hp - dmg);
    for (const [, ships] of sides) for (const s of ships) if (s.hp < 0) s.hp = 0;
  }

  // Record losses
  for (const [owner, ships] of sides) {
    const lost = ships.filter(s => s.hp <= 0 && !s.isBattery).length;
    const p = playerById(game, owner);
    if (p) { p.stats.losses += lost; }
  }
  if (battery && battery.hp <= 0) {
    planet._orbitLost = true;
    const before = planet.pop;
    planet.pop = Math.round(Math.max(0, planet.pop * 0.7) * 10) / 10;
    entries.push({ type: 'combat', planetId: planet.id, playerIds: [planet.owner],
      key: 'log.batteryBroken',
      params: { planet: planet.name, before: round1(before), after: round1(planet.pop) } });
  }
  // Remove the dead - satellites aboard go down with their transporter
  for (const f of game.fleets) {
    if (!here(f) && !fleeing.includes(f)) continue;
    cargoLost(f, f.ships.filter(s => s.hp <= 0), planet, entries);
    f.ships = f.ships.filter(s => s.hp > 0);
  }
  if (planet.defenses) planet.defenses = planet.defenses.filter(s => s.hp > 0);
  if (station && station.hp <= 0) {
    planet.station = null;
    entries.push({ type: 'combat', planetId: planet.id, playerIds: [...sides.keys()].filter(o => !isAlien(o)),
      key: station.building > 0 ? 'log.stationSiteLost' : 'log.stationLost', params: { planet: planet.name } });
  }

  // Whoever still has weapons controls the orbit; defenseless ships are lost.
  const armedOwners = new Set();
  for (const f of game.fleets) if (here(f) && f.ships.some(s => s.attack > 0)) armedOwners.add(f.owner);
  if (planet.defenses && planet.defenses.some(s => s.attack > 0)) armedOwners.add(planet.owner);
  if (planet.station && !(planet.station.building > 0) && planet.station.attack > 0) armedOwners.add(planet.owner);
  if (battery && battery.hp > 0) armedOwners.add(planet.owner);
  // The orbit belongs to the armed if they are no longer at war with each
  // other - alone or as allies. Whoever is at war with them loses what is left.
  const scuttled = [];
  const victors = [...armedOwners];
  // In open space nobody holds anything - whoever survives flies on.
  if (!group && victors.length && victors.every(a => victors.every(b => !hostile(game, a, b)))) {
    for (const f of game.fleets) {
      if (f.at === planet.id && victors.some(v => hostile(game, v, f.owner)) && f.ships.length) {
        const p = playerById(game, f.owner);
        if (p) p.stats.losses += f.ships.length;
        for (const s of f.ships) if (idx.has(s)) scuttled.push(idx.get(s));
        cargoLost(f, f.ships, planet, entries);
        f.ships = [];
      }
    }
  }

  // Every side as its own item - the sentence around it belongs in the catalog.
  const tally = [];
  for (const [owner, n] of before) {
    const p = playerById(game, owner);
    const left = (game.fleets.filter(f => (here(f) || fleeing.includes(f)) && f.owner === owner)
      .reduce((a, f) => a + f.ships.length, 0))
      + (planet.owner === owner && planet.defenses ? planet.defenses.length : 0)
      + (planet.owner === owner && station && planet.station === station ? 1 : 0);
    // The aliens have no name of their own - the client gives them one.
    tally.push({ name: p ? p.name : String(owner), left, before: n, ...(isAlien(owner) ? { alien: true } : {}) });
  }
  entries.push({
    type: 'combat', planetId: planet.id, playerIds: [...before.keys()],
    ...(group
      ? { at: { x: Math.round(planet.at.x), y: Math.round(planet.at.y), z: Math.round(planet.at.z || 0) },
        key: 'log.battleSpace', params: { near: planet.name, sides: tally } }
      : { key: 'log.battle', params: { planet: planet.name, sides: tally } }),
    battle: { sides: owners, units, rounds, scuttled, fled: [...escaping].map(s => idx.get(s)) }
  });
  cleanupFleets(game);
  return true;
}

/** Satellites that went down with lost transporters - told to the owner only. */
function cargoLost(fleet, ships, planet, entries) {
  const n = ships.reduce((a, s) => a + (s.cargo ? s.cargo.length : 0), 0);
  if (n) entries.push({ type: 'warn', playerIds: [fleet.owner], private: fleet.owner, planetId: planet.id,
    key: 'log.cargoLost', params: { planet: planet.name, count: n } });
}
