// What an AI empire knows - with fog of war the same as a human player in
// its place (server/game/sensors.js). Without fog everything stays as it
// was: the live worlds, every fleet, every course, every tally.
//
// With fog:
// - worlds out of sensor reach look as they did when last seen (owner,
//   population, satellites, station); never seen ones as empty;
// - foreign fleets only within sensor reach, and their target only under
//   the rule of the view (intel.js courseIntel);
// - other empires' size only from their known worlds - the tallies in the
//   player list are hidden from humans too. Allies share theirs.
//   Their tech level is not known either: estimated by the own one.
import { fogOn, eyesOf, covered } from '../game/sensors.js';
import { seesFleet, courseIntel } from '../game/intel.js';
import { teamOf } from '../game/diplomacy.js';

/**
 * All worlds as this empire sees them, indexed by id like
 * game.galaxy.planets. Live objects where it has sight, stand-ins from its
 * memory elsewhere - only to read from: orders still go by id.
 */
export function perceivedPlanets(game, bot) {
  const all = game.galaxy.planets;
  if (!fogOn(game)) return all;
  const team = teamOf(game, bot.id);
  const eyes = eyesOf(game, bot.id);
  const orbit = new Set(game.fleets.filter(f => team.includes(f.owner) && f.at != null && f.ships.length).map(f => f.at));
  return all.map(p => {
    if (team.includes(p.owner) || orbit.has(p.id) || covered(eyes, p)) return p;
    const k = bot.knowledge[p.id];
    if (!k) return { ...p, owner: null, pop: 0, defenses: [], station: null, unseen: true };
    // A memory of an own world is outdated - the loss was reported (as in buildView).
    const owner = k.owner === bot.id ? p.owner : k.owner;
    const n = k.defenses || 0, hp = n ? (k.defHp || 0) / n : 0;
    return {
      ...p, owner, pop: k.pop, metalReserve: k.metalReserve, seenTurn: k.turn,
      defenses: Array.from({ length: n }, () => ({ hp, maxHp: hp, attack: 0 })),
      station: k.station ? { ...k.station } : null
    };
  });
}

/**
 * The foreign fleets this empire sees, each with the target it knows of
 * (`knownDest`: a world id or null). Own fleets are not in it.
 * @returns {{f: object, knownDest: number|null}[]}
 */
export function seenFleets(game, bot) {
  const fog = fogOn(game);
  const eyes = fog ? eyesOf(game, bot.id) : null;
  const out = [];
  for (const f of game.fleets) {
    if (f.owner === bot.id || !f.ships.length) continue;
    if (!fog) { out.push({ f, knownDest: f.dest ?? null }); continue; }
    if (!seesFleet(game, bot.id, f, eyes)) continue;
    out.push({ f, knownDest: courseIntel(game, bot, f, eyes).dest });
  }
  return out;
}

/** How many inhabitants this empire believes another one has. */
export function popOf(game, bot, planets) {
  if (!fogOn(game)) return id => game.players.find(p => p.id === id)?.stats.pop || 0;
  const team = teamOf(game, bot.id);
  const sum = new Map();
  for (const p of planets) if (p.owner) sum.set(p.owner, (sum.get(p.owner) || 0) + (p.pop || 0));
  return id => team.includes(id) ? game.players.find(p => p.id === id)?.stats.pop || 0 : sum.get(id) || 0;
}

/** The tech of another empire, as far as known: with fog the own level as an estimate. */
export function techOf(game, bot, holder) {
  return fogOn(game) ? bot.tech : holder.tech;
}
