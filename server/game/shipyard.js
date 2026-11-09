// The shipyards: ordering ships, refitting old ones to the newest levels,
// taking them apart again, and naming the big ones. A shipyard is any own
// world with at least a million people. Only what can be paid for at the end
// of the turn is accepted (economy.js).
import {
  BUILD_TYPES, buildTypesFor, buildLock, buildCost, SHIP_DEFS, STATION, REPAIR_SHARE, shipStats, refitCost, recycleValue
} from '../../shared/rules.js';
import { affordable } from './economy.js';
import { addShip, orbitFleet, cleanupFleets } from './fleets.js';
import { planetById } from './game.js';

/** Change a build order; empty entries disappear. */
function buildStep(player, planetId, type, delta) {
  const q = player.orders.builds[planetId] || (player.orders.builds[planetId] = {});
  q[type] = Math.max(0, (q[type] || 0) + delta);
  if (q[type] === 0) delete q[type];
  if (!Object.keys(q).length) delete player.orders.builds[planetId];
}

/** A build order: count > 0 orders more, count < 0 takes some back. */
export function orderBuild(game, player, b) {
  const { planetId, type } = b;
  const count = Math.round(Number(b.count));
  const planet = planetById(game, planetId);
  if (!planet || planet.owner !== player.id || !BUILD_TYPES.includes(type) || !Number.isFinite(count) || !count) return;
  if (count > 0 && !buildTypesFor(game.settings).includes(type)) return { error: 'yard.noCapitals' };
  if (count < 0) { buildStep(player, planetId, type, count); return; }
  // Where nobody lives, the server does not build - so accept nothing either.
  if (planet.pop < 1) return { error: 'yard.needPop' };
  const lock = buildLock(type, player.tech, planet.pop, planet.station || null);
  // The destroyer needs a station instead of a large world - its own sentence.
  if (lock) return { error: SHIP_DEFS[type].requires.station ? 'yard.lockedStation' : 'yard.locked', params: { ...SHIP_DEFS[type].requires } };
  // One station per world - already there, under construction or ordered.
  if (type === 'station' && (planet.station || player.orders.builds[planetId]?.station)) return { error: 'yard.stationExists' };
  for (let i = 0; i < Math.min(count, type === 'station' ? 1 : 99); i++) {
    buildStep(player, planetId, type, 1);
    if (!affordable(game, player)) {
      buildStep(player, planetId, type, -1);
      return { error: 'notice.buildUnaffordable' };
    }
  }
}

/**
 * A refit order for a fleet or the satellites of a world. Carried out at the
 * end of the turn after research, so right away with the newest levels.
 */
export function orderRefit(game, player, r) {
  // Refit: a fleet in orbit of an own shipyard, or the satellites of an own
  // world. Carried out at the end of the turn after research, so right away
  // with the newest levels.
  const key = r.fleetId != null ? 'f:' + r.fleetId : 'p:' + r.planetId;
  if (r.value === false) { delete player.orders.refit[key]; return; }
  if (r.fleetId != null) {
    const fleet = game.fleets.find(f => f.id === r.fleetId);
    if (!fleet || fleet.owner !== player.id) return { error: 'err.noSuchFleet' };
    const planet = fleet.at != null ? planetById(game, fleet.at) : null;
    if (!planet || planet.owner !== player.id || planet.pop < 1) return { error: 'err.refitNoYard' };
  } else {
    const planet = planetById(game, r.planetId);
    if (!planet || planet.owner !== player.id || planet.pop < 1) return { error: 'err.refitNoYard' };
  }
  player.orders.refit[key] = true;
  if (!affordable(game, player)) {
    delete player.orders.refit[key];
    return { error: 'notice.refitUnaffordable' };
  }
}

/**
 * Ships are built at the end of the turn, then the refits are done, then the
 * stations under construction get on - prices and locks go by the state the
 * player saw when ordering, as in the forecast (shared/budget.js).
 */
export function buildShips(game, entries) {
  for (const p of game.players) {
    if (!p.alive) continue;
    for (const [pid, queue] of Object.entries(p.orders.builds)) {
      const planet = planetById(game, Number(pid));
      if (!planet || planet.owner !== p.id || planet.pop < 1) continue;
      for (const type of BUILD_TYPES) {
        let n = queue[type] || 0;
        let built = 0;
        if (type === 'station' && n > 0 && planet.station) continue;
        // Accepted only when unlocked - but the world may have lost people
        // (or its station) since, and research never goes back.
        if (n > 0 && buildLock(type, p.tech, planet.pop, planet.station || null)) {
          entries.push({ type: 'warn', playerIds: [p.id], private: p.id, planetId: planet.id,
            key: 'log.buildLocked', params: { planet: planet.name, ship: type } });
          continue;
        }
        while (n-- > 0) {
          const cost = buildCost(type, p.tech, planet);
          if (p.money < cost.money || p.metal < cost.metal) break;
          p.money -= cost.money;
          p.metal -= cost.metal;
          p.ledger.build.money += cost.money; p.ledger.build.metal += cost.metal;
          if (type === 'satellite') {
            (planet.defenses || (planet.defenses = [])).push(makeDefense(game, type, p.tech));
          } else if (type === 'station') {
            planet.station = { ...makeDefense(game, type, p.tech), building: STATION.buildTurns, since: game.turn };
            n = 0;
          } else {
            addShip(game, orbitFleet(game, p.id, planet), type, p.tech);
          }
          built++;
        }
        if (built > 0) {
          entries.push({ type: 'build', playerIds: [p.id], private: p.id, planetId: planet.id,
            ...(type === 'station'
              ? { key: 'log.stationStarted', params: { planet: planet.name, turns: STATION.buildTurns } }
              : { key: 'log.built', params: { planet: planet.name, count: built, ship: type } }) });
        }
        if (n + 1 > 0 && built < (queue[type] || 0)) {
          entries.push({ type: 'warn', playerIds: [p.id], private: p.id, planetId: planet.id,
            key: 'log.buildShort', params: { planet: planet.name } });
        }
      }
    }
    p.orders.builds = {};
    refitOrders(game, p, entries);
  }
  advanceStations(game, entries);
}

/**
 * Stations under construction get one turn further; a finished one says so.
 * A ready station mends its hull like a destroyer mends its fleet - but not
 * in a turn with a battle at its world (see repairStations, after combat).
 */
function advanceStations(game, entries) {
  for (const planet of game.galaxy.planets) {
    const st = planet.station;
    if (!st || !(st.building > 0) || st.since === game.turn) continue;
    if (!planet.owner) { planet.station = null; continue; }
    st.building--;
    if (st.building > 0) continue;
    delete st.building;
    entries.push({ type: 'build', playerIds: [planet.owner], private: planet.owner, planetId: planet.id,
      key: 'log.stationReady', params: { planet: planet.name } });
  }
}

/** After the battles: stations where nobody fought get REPAIR_SHARE of their hull back. */
export function repairStations(game, fought) {
  for (const planet of game.galaxy.planets) {
    const st = planet.station;
    if (!st || fought.has(planet.id) || st.hp >= st.maxHp) continue;
    st.hp = Math.min(st.maxHp, Math.round((st.hp + st.maxHp * REPAIR_SHARE) * 10) / 10);
  }
}

function makeDefense(game, type, tech) {
  const st = shipStats(type, tech);
  return {
    id: 's' + game.nextShipId++, type, tech: { ...tech },
    hp: st.maxHp, maxHp: st.maxHp,
    attack: Math.round(st.attack * 10) / 10, speed: 0, range: 0, colonists: 0, isTanker: false
  };
}

/**
 * Carries out a player's refit orders. If the money is not enough for all
 * of them, as many ships are refitted as can be paid for.
 */
function refitOrders(game, p, entries) {
  for (const key of Object.keys(p.orders.refit)) {
    const [kind, id] = [key.slice(0, 1), key.slice(2)];
    let ships, planet;
    if (kind === 'f') {
      const fleet = game.fleets.find(f => f.id === id && f.owner === p.id);
      planet = fleet && fleet.at != null ? planetById(game, fleet.at) : null;
      ships = fleet ? fleet.ships : [];
    } else {
      planet = planetById(game, Number(id));
      ships = planet?.defenses || [];
    }
    if (!planet || planet.owner !== p.id || planet.pop < 1) continue;
    let done = 0, short = false;
    for (const s of ships) {
      const c = refitCost(s.type, s.tech, p.tech);
      if (!c) continue;
      if (p.money < c.money || p.metal < c.metal) { short = true; continue; }
      p.money -= c.money;
      p.metal -= c.metal;
      p.ledger.refit.money += c.money; p.ledger.refit.metal += c.metal;
      const st = shipStats(s.type, c.tech);
      // The damage stays - only what the better armor adds is new.
      s.hp = Math.max(1, s.hp + st.maxHp - s.maxHp);
      s.maxHp = st.maxHp;
      s.attack = Math.round(st.attack * 10) / 10;
      if (s.speed > 0 || st.speed > 0) s.speed = Math.round(st.speed);
      if (s.range > 0 || st.range > 0) s.range = Math.round(st.range);
      s.tech = c.tech;
      done++;
    }
    if (done) entries.push({ type: 'build', playerIds: [p.id], private: p.id, planetId: planet.id,
      key: 'log.refitted', params: { planet: planet.name, count: done } });
    if (short) entries.push({ type: 'warn', playerIds: [p.id], private: p.id, planetId: planet.id,
      key: 'log.refitShort', params: { planet: planet.name } });
  }
  p.orders.refit = {};
}

/**
 * Recycling: a fleet in orbit of an own shipyard, or satellites of an own
 * world, are taken apart right away - like loading and splitting, so the
 * metal can go into ships in the same turn. Satellites aboard a recycled
 * transporter are set down first, they are not part of the deal. Only
 * accepted if the orders placed so far can still be paid for afterwards.
 */
export function recycle(game, player, o) {
  let planet, fleet = null, ships;
  if (o.fleetId != null) {
    fleet = game.fleets.find(f => f.id === o.fleetId);
    if (!fleet || fleet.owner !== player.id) return { error: 'err.noSuchFleet' };
    planet = fleet.at != null ? planetById(game, fleet.at) : null;
    ships = fleet.ships;
  } else {
    planet = planetById(game, o.planetId);
    const sats = planet?.defenses || [];
    const want = o.count == null ? sats.length : Math.max(0, Math.round(Number(o.count)) || 0);
    // The oldest first - those are the ones worth the least in battle.
    ships = [...sats].sort((a, b) => techSum(a) - techSum(b)).slice(0, want);
  }
  if (!planet || planet.owner !== player.id || planet.pop < 1) return { error: 'err.recycleNoYard' };
  if (!ships.length) return { error: 'err.recycleNothing' };
  const v = recycleValue(ships, player.tech.recycling);
  if (!v) return { error: 'err.recycleLocked' };
  if (player.money < v.money) return { error: 'notice.recycleUnaffordable' };
  const money = player.money, metal = player.metal;
  player.money -= v.money;
  player.metal += v.metal;
  if (!affordable(game, player)) {
    player.money = money; player.metal = metal;
    return { error: 'notice.recycleUnaffordable' };
  }
  if (fleet) {
    const defenses = planet.defenses || (planet.defenses = []);
    for (const s of ships) if (s.cargo?.length) defenses.push(...s.cargo);
    fleet.ships = [];
    delete player.orders.moves[fleet.id];
    delete player.orders.refit['f:' + fleet.id];
    cleanupFleets(game);
  } else {
    planet.defenses = planet.defenses.filter(s => !ships.includes(s));
  }
  return { recycled: { count: v.count, money: v.money, metal: v.metal, planetId: planet.id } };
}

function techSum(s) {
  return Object.values(s.tech || {}).reduce((a, x) => a + x, 0);
}

/** Renaming one of the own named ships. */
export function renameShip(game, player, o) {
  // Big ships carry a name - the owner may give them another one.
  const ship = game.fleets.filter(f => f.owner === player.id).flatMap(f => f.ships)
    .find(s => s.id === o.shipId);
  if (!ship || ship.name == null) return { error: 'err.noSuchShip' };
  const name = cleanShipName(o.name);
  if (!name) return { error: 'err.shipName' };
  ship.name = name;
}

export const SHIP_NAME_MAX = 28;

/**
 * Ship names end up in the client via innerHTML, like player names (see
 * cleanName in server/profile.js): nothing that reads as markup, no control
 * characters, the apostrophe as the letter apostrophe.
 */
function cleanShipName(name) {
  return String(name ?? '')
    .replace(/['`]/g, 'ʼ')
    .replace(/[\u0000-\u001f\u007f<>&"\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SHIP_NAME_MAX)
    .trim();
}

/**
 * Dev mode: a destroyer right away and for free, in the orbit of an own
 * world - the given one, otherwise the homeworld - built with the current
 * levels. Testing it should not take forty turns of research.
 * @returns {boolean} whether one was placed
 */
export function devDestroyer(game, player, planetId) {
  if (!player?.alive || game.settings.capitalShips === false) return false;
  let planet = planetId != null ? planetById(game, planetId) : null;
  if (!planet || planet.owner !== player.id) planet = planetById(game, player.homeworld);
  if (!planet || planet.owner !== player.id) planet = game.galaxy.planets.find(p => p.owner === player.id);
  if (!planet) return false;
  addShip(game, orbitFleet(game, player.id, planet), 'destroyer', player.tech);
  return true;
}

/**
 * Dev mode: a ready orbital station right away and for free at an own world
 * - the given one, otherwise the homeworld. Replaces one that is there.
 * @returns {boolean} whether one was placed
 */
export function devStation(game, player, planetId) {
  if (!player?.alive || game.settings.capitalShips === false) return false;
  let planet = planetId != null ? planetById(game, planetId) : null;
  if (!planet || planet.owner !== player.id) planet = planetById(game, player.homeworld);
  if (!planet || planet.owner !== player.id) planet = game.galaxy.planets.find(p => p.owner === player.id);
  if (!planet) return false;
  planet.station = makeDefense(game, 'station', player.tech);
  return true;
}
