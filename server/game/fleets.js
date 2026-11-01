// Fleets and their ships: creating them, what a fleet is capable of as a
// whole, splitting and merging - and the satellites transporters carry.
import { shipStats, SHIP_DEFS, cargoOf } from '../../shared/rules.js';
import { pickShipName } from '../shipnames.js';
import { affordable } from './economy.js';
import { planetById } from './game.js';

export function newFleet(game, owner, planet) {
  const f = {
    id: 'f' + game.nextFleetId++,
    owner,
    ships: [],
    at: planet ? planet.id : null,
    x: planet ? planet.x : 0,
    y: planet ? planet.y : 0,
    z: planet ? (planet.z || 0) : 0,
    dest: null,
    hole: null           // course to a wormhole mouth instead of a world
  };
  game.fleets.push(f);
  return f;
}

export function addShip(game, fleet, type, tech) {
  const st = shipStats(type, tech);
  const ship = {
    id: 's' + game.nextShipId++,
    type,
    tech: { ...tech },
    hp: st.maxHp,
    maxHp: st.maxHp,
    attack: Math.round(st.attack * 10) / 10,
    speed: Math.round(st.speed),
    range: Math.round(st.range),
    colonists: st.colonists,
    isTanker: st.isTanker
  };
  if (st.cargo) ship.cargo = [];        // satellites on board
  if (SHIP_DEFS[type].named) ship.name = pickShipName(game);
  fleet.ships.push(ship);
  return ship;
}

export function orbitFleet(game, owner, planet) {
  let f = game.fleets.find(f => f.owner === owner && f.at === planet.id && f.dest == null && !f.hole);
  if (!f) f = newFleet(game, owner, planet);
  return f;
}

/** Fleet stats: speed = slowest ship, range = best one + tankers. */
export function fleetStats(fleet) {
  let speed = Infinity, range = 0, attack = 0, hp = 0, tankers = 0;
  for (const s of fleet.ships) {
    if (s.speed > 0) speed = Math.min(speed, s.speed);
    range = Math.max(range, s.range);
    attack += s.attack;
    hp += s.hp;
    if (s.isTanker) tankers++;
  }
  if (!isFinite(speed)) speed = 0;
  if (tankers > 1) range += range * 0.15 * (tankers - 1);
  return { speed, range: Math.round(range), attack: Math.round(attack * 10) / 10, hp, count: fleet.ships.length };
}

export function cleanupFleets(game) {
  game.fleets = game.fleets.filter(f => f.ships.length > 0);
}

/**
 * Splitting a fleet. In orbit the split-off part stays behind without a
 * course, the rest keeps it. In flight both parts fly on to the same target
 * until the new one gets a course of its own - nobody is left adrift in deep
 * space by accident. Movement checks the range of each part again.
 */
export function splitFleet(game, player, o) {
  const fleet = game.fleets.find(f => f.id === o.fleetId);
  if (!fleet || fleet.owner !== player.id) return;
  const take = o.ships || [];
  let moved = fleet.ships.filter(s => take.includes(s.id));
  // each: every ship becomes a fleet of its own (colony ships to several
  // worlds). Then all ships may be named - the first stays in the fleet.
  const each = o.each === true;
  if (each && moved.length === fleet.ships.length) moved = moved.slice(1);
  if (!moved.length || moved.length === fleet.ships.length) return;
  fleet.ships = fleet.ships.filter(s => !moved.includes(s));
  const planet = fleet.at != null ? planetById(game, fleet.at) : null;
  const parts = each ? moved.map(s => [s]) : [moved];
  const ids = parts.map(ships => {
    const nf = newFleet(game, player.id, planet);
    nf.ships = ships;
    if (!planet) {
      nf.x = fleet.x; nf.y = fleet.y; nf.z = fleet.z;
      nf.dest = fleet.dest;
      nf.hole = fleet.hole;
      if (fleet.dest != null) player.orders.moves[nf.id] = fleet.dest;
    }
    return nf.id;
  });
  return { newFleet: ids[0] };
}

/** All idle fleets of an empire in orbit of a world become one. */
export function mergeFleets(game, player, o) {
  const planet = planetById(game, o.planetId);
  if (!planet) return;
  const own = game.fleets.filter(f => f.owner === player.id && f.at === planet.id && f.dest == null && !f.hole);
  if (own.length < 2) return;
  const target = own[0];
  for (const f of own.slice(1)) { target.ships.push(...f.ships); f.ships = []; }
  cleanupFleets(game);
}

/**
 * Transporters take satellites aboard from the orbit of an own world or set
 * them down there. Right away, like splitting and merging: whoever loads can
 * set off in the same turn. Satellites keep their damage and tech level.
 */
export function loadOrDrop(game, player, o, load) {
  const fleet = game.fleets.find(f => f.id === o.fleetId);
  if (!fleet || fleet.owner !== player.id) return { error: 'err.noSuchFleet' };
  const planet = fleet.at != null ? planetById(game, fleet.at) : null;
  if (!planet || planet.owner !== player.id) return { error: 'err.cargoOwnWorld' };
  const holds = fleet.ships.filter(s => s.cargo);
  if (!holds.length) return { error: 'err.noTransporter' };
  const want = o.count == null ? Infinity : Math.max(0, Math.round(Number(o.count)) || 0);
  const defenses = planet.defenses || (planet.defenses = []);
  if (load) {
    const n = Math.min(want, cargoOf(fleet.ships).room, defenses.length);
    if (!defenses.length) return { error: 'err.noSatellites' };
    if (n <= 0) return { error: 'err.cargoFull' };
    // Spread over the transporters: if one is shot down, not everything is lost.
    for (let i = 0; i < n; i++) {
      const hold = holds.filter(s => s.cargo.length < SHIP_DEFS[s.type].cargo)
        .sort((a, b) => a.cargo.length - b.cargo.length)[0];
      hold.cargo.push(defenses.pop());
    }
    return;
  }
  const aboard = holds.reduce((a, s) => a + s.cargo.length, 0);
  if (!aboard) return { error: 'err.cargoEmpty' };
  const n = Math.min(want, aboard);
  const dropped = [];
  for (let i = 0; i < n; i++) {
    const hold = holds.filter(s => s.cargo.length).sort((a, b) => b.cargo.length - a.cargo.length)[0];
    const sat = hold.cargo.pop();
    defenses.push(sat);
    dropped.push([hold, sat]);
  }
  // A refit order for this world now covers more satellites - only accept
  // that if it can still be paid for.
  if (player.orders.refit['p:' + planet.id] && !affordable(game, player)) {
    for (const [hold, sat] of dropped.reverse()) { defenses.splice(defenses.indexOf(sat), 1); hold.cargo.push(sat); }
    return { error: 'notice.dropRefit' };
  }
}
