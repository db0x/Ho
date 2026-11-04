// Wormholes for the curious empires: probing them, sending settlers and
// raids through - and coming home before they collapse.
import { supplyDistance, travelDistance, dist, WORMHOLE } from '../../shared/rules.js';
import { fleetStats } from '../game/fleets.js';
import { canReach } from '../game/movement.js';
import { setOrders } from '../game/orders.js';

/**
 * The mouth a fleet on the far side of a known wormhole has to fly into to
 * get home - null if it is on this side. Same test as supplyNeed in
 * shared/rules.js: closer to home through the wormhole than through space.
 */
export function backDoor(s, f) {
  const { home, zone, game, bot } = s;
  if (!home.length) return null;
  const direct = supplyDistance(home, f, zone);
  for (const h of game.wormholes) {
    if (!bot.knownHoles.has(h.id)) continue;
    for (let i = 0; i < 2; i++) {
      const b = h.mouths[i], a = h.mouths[1 - i];
      if (supplyDistance(home, a, zone) + travelDistance(b, f, zone) < direct) return { hole: h, mouth: b };
    }
  }
  return null;
}

/**
 * Curious empires use the wormholes they see. As long as nobody knows
 * where one leads, a scout goes through first - a cheap look. Once the far
 * side is known, colony ships follow if free worlds wait there and land at
 * home is getting scarce; whoever hunts sends a pack against weak worlds
 * over there. Only through wormholes that hold long enough for the trip,
 * and one fleet per wormhole every few turns - not the whole empire.
 */
export function wormholeTrips(s) {
  const {
    ai, game, bot, zone, P, strikePower, home, settleable, inRange, solo, enemyWorlds, price, margin
  } = s;
  ai.trips = ai.trips || {};          // wormhole -> turn before which nothing else is sent
  const idle = game.fleets.filter(f => f.owner === bot.id && f.dest == null && !f.hole && !f.chase && f.ships.length
    && fleetStats(f).speed > 0 && !f.ships.some(s => s.cargo) && !backDoor(s, f));
  for (const h of game.wormholes) {
    if ((ai.trips[h.id] || 0) > game.turn) continue;
    const known = bot.knownHoles.has(h.id);
    for (let i = 0; i < 2; i++) {
      const m = h.mouths[i], exit = h.mouths[1 - i];
      if (!bot.seenMouths.has(m.id)) continue;
      const toMouth = f => travelDistance(f, m, zone) / fleetStats(f).speed;
      const fits = (f, beyond = 0) => h.closes - game.turn > toMouth(f) + beyond + 3 && canReach(game, f, m).ok;
      const nearest = list => list.sort((a, b) => toMouth(a) - toMouth(b))[0] || null;
      let pick = null;
      if (!known) {
        pick = nearest(idle.filter(f => f.ships.every(s => s.attack <= 0 && !s.colonists) && fits(f)));
        // The raider does not wait for a scout: a small pack jumps blind
        // and looks for prey over there itself.
        if (!pick && P.packs) {
          pick = nearest(idle.filter(f => strikePower(f) > 0 && f.ships.length <= 6
            && !f.ships.some(s => s.colonists) && fits(f, 4)));
        }
      } else {
        const homeToMouth = supplyDistance(home, m, zone);
        const beyond = (f, p) => homeToMouth + travelDistance(exit, p, zone) <= fleetStats(f).range;
        // Settlers: free worlds over there - when land at home runs short,
        // or for an empire that lives to spread.
        const land = settleable.filter(p => !claimed(p) && dist(p, exit) < 400);
        if (land.length && (inRange.length <= 2 || P.settlers >= 4)) {
          pick = nearest(idle.filter(f => f.ships.some(s => s.colonists > 0)
            && land.some(p => beyond(f, p)) && fits(f, travelDistance(exit, land[0], zone) / fleetStats(f).speed)));
        }
        // Hunters: weak enemy worlds over there that this fleet cracks.
        if (!pick && (solo === 'prey' || solo === 'carrion')) {
          const prey = enemyWorlds.filter(p => dist(p, exit) < 400);
          pick = nearest(idle.filter(f => {
            const strike = strikePower(f);
            return strike > 0 && fits(f, 2)
              && prey.some(p => beyond(f, p) && price(p) * margin <= strike);
          }));
        }
      }
      if (!pick) continue;
      setOrders(game, bot, { move: { fleetId: pick.id, hole: m.id } });
      if (pick.hole === m.id) {
        ai.trips[h.id] = game.turn + (known ? 3 : 8);
        idle.splice(idle.indexOf(pick), 1);
        break;
      }
    }
  }
  function claimed(p) {
    return game.fleets.some(f => f.owner === bot.id && f.dest === p.id && f.ships.some(s => s.colonists > 0));
  }
}

/**
 * Fleets on the far side come home through the wormhole once they have
 * nothing left to do there - or right away once it turns unstable, before
 * it strands them. Ships already on their way to a target over there keep
 * going; a colony ship that lands makes the far side home anyway.
 */
export function comeBack(s) {
  const { game, bot, zone } = s;
  for (const f of game.fleets.filter(f => f.owner === bot.id && !f.hole && !f.chase && f.ships.length)) {
    const door = backDoor(s, f);
    if (!door) continue;
    // Late enough that the way back to the mouth still fits before it collapses.
    const back = travelDistance(f, door.mouth, zone) / (fleetStats(f).speed || 1);
    const shaky = door.hole.closes - game.turn <= Math.max(WORMHOLE.unstable, Math.ceil(back) + 2);
    if (f.dest != null && !shaky) continue;
    if (f.dest != null && f.ships.some(s => s.colonists > 0)) continue;
    setOrders(game, bot, { move: { fleetId: f.id, hole: door.mouth.id } });
  }
}
