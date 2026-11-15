// The spoils of an alien raid beaten off (rules in shared/rules.js,
// ALIEN_SPOILS). Whoever did the most damage to an alien carrier that went
// down gets the credit - the empire the aliens visited or anyone who came
// to help:
//   - insight: research points in weapons and shields, the more the further
//     the aliens were ahead,
//   - a trophy for the destroyer of the victor that hit the carrier hardest,
//     and one for the empire: the ranking shows everyone how many it shot down,
//   - and the wreck: it stays in the orbit, full of metal, for a few turns.
//     Any fleet there salvages a share every turn, a transporter twice as
//     fast - the victor's, a neighbour's who came for it, or both. Shot down
//     in open space, the victor's fleet takes it all on the spot.
import { ALIEN_SPOILS, SHIP_DEFS, alienInsight, wreckMetal, salvageRate, techCostToNext, techMaxLevel } from '../shared/rules.js';
import { watchers } from './aliens.js';
import { hostile } from './game/diplomacy.js';
import { planetById, playerById } from './game/game.js';

const INSIGHT_FIELDS = ['weapons', 'shields'];

/** The wrecks of a game: { planetId, metal, total, born, until }. */
export const wrecksOf = game => game.wrecks || (game.wrecks = []);

/** The wreck in the orbit of this world, or null. */
export const wreckAt = (game, planetId) => wrecksOf(game).find(w => w.planetId === planetId) || null;

/** What everyone who sees the world sees of its wreck: metal left, of how much, and until when. */
export function wreckView(game, planetId) {
  const w = wreckAt(game, planetId);
  return w ? { metal: w.metal, total: w.total, until: w.until } : null;
}

/** The wrecks an empire sees right now - for the AI, by the same rules as the map. */
export function wrecksSeen(game, playerId) {
  return wrecksOf(game).filter(w => watchers(game, planetById(game, w.planetId)).includes(playerId));
}

/**
 * Research points into a field, and the breakthroughs they make - as the
 * research of a turn does it. Returns the new level if one was reached.
 */
function learn(p, field, points) {
  if (points <= 0 || p.tech[field] >= techMaxLevel(field)) return null;
  const before = p.tech[field];
  p.researchPoints[field] += points;
  while (p.tech[field] < techMaxLevel(field) && p.researchPoints[field] >= techCostToNext(p.tech[field])) {
    p.researchPoints[field] -= techCostToNext(p.tech[field]);
    p.tech[field]++;
  }
  return p.tech[field] > before ? p.tech[field] : null;
}

/** The side with the most damage on the carrier - among the empires still in the game. */
function victorOf(game, kill) {
  let best = null, most = 0;
  for (const [owner, dmg] of kill.bySide) {
    const p = playerById(game, owner);
    if (p && p.alive && dmg > most) { best = p; most = dmg; }
  }
  return best;
}

/**
 * After the battles: every carrier shot down this turn (combat.js collects
 * them) brings its spoils.
 */
export function alienSpoils(game, entries) {
  const kills = game._carrierKills || [];
  game._carrierKills = [];
  for (const kill of kills) {
    const victor = victorOf(game, kill);
    if (!victor) continue;
    const tech = kill.carrier.tech || {};
    const where = kill.planetId ?? null;
    // Counted for the empire - the ranking shows it to everyone.
    victor.stats.carriers = (victor.stats.carriers || 0) + 1;

    // Insight: what the carrier was built with, measured against the own levels.
    const shares = {}, advanced = [];
    for (const f of INSIGHT_FIELDS) {
      const share = victor.tech[f] >= techMaxLevel(f) ? 0 : alienInsight(tech[f], victor.tech[f]);
      shares[f] = Math.round(share * 100);
      const level = learn(victor, f, share * techCostToNext(victor.tech[f]));
      if (level) advanced.push({ field: f, level });
    }
    entries.push({ type: 'alien', playerIds: [victor.id], private: victor.id, planetId: where,
      key: shares.weapons || shares.shields ? 'log.alienKill' : 'log.alienKillPlain',
      params: { near: kill.near, weapons: shares.weapons, shields: shares.shields } });
    if (advanced.length) {
      entries.push({ type: 'tech', playerIds: [victor.id], private: victor.id,
        key: 'log.breakthrough', params: { fields: advanced } });
    }

    // The trophy: the victor's named ship that hit the carrier hardest and came through.
    let ace = null, most = 0;
    for (const [ship, dmg] of kill.byShip) {
      if (!SHIP_DEFS[ship.type]?.named || !(ship.hp > 0) || ship.name == null || dmg <= most) continue;
      if (!game.fleets.some(f => f.owner === victor.id && f.ships.includes(ship))) continue;
      ace = ship; most = dmg;
    }
    if (ace) {
      ace.trophies = (ace.trophies || 0) + 1;
      entries.push({ type: 'alien', playerIds: [victor.id], private: victor.id, planetId: where,
        key: 'log.alienTrophy', params: { vessel: ace.name, near: kill.near, count: ace.trophies } });
    }

    // The wreck.
    const metal = wreckMetal(tech);
    if (where == null) {
      // In open space: the victor's fleet that fought there takes it all - if it is still there.
      const there = game.fleets.some(f => f.owner === victor.id && f.ships.length && kill.fleets?.includes(f.id));
      if (there) {
        victor.metal += metal;
        if (victor.ledger) victor.ledger.salvage += metal;
        entries.push({ type: 'alien', playerIds: [victor.id], private: victor.id, planetId: null,
          key: 'log.wreckTaken', params: { near: kill.near, metal } });
      }
      continue;
    }
    const old = wreckAt(game, where);
    const until = game.turn + ALIEN_SPOILS.life;
    if (old) { old.metal += metal; old.total += metal; old.until = Math.max(old.until, until); old.born = game.turn; }
    else wrecksOf(game).push({ planetId: where, metal, total: metal, born: game.turn, until });
    const planet = planetById(game, where);
    const eyes = watchers(game, planet);
    if (!eyes.includes(victor.id)) eyes.push(victor.id);
    entries.push({ type: 'alien', playerIds: eyes, planetId: where,
      key: 'log.wreck', params: { planet: planet.name, metal, turns: ALIEN_SPOILS.life } });
  }
}

/**
 * May this empire salvage in the orbit of this world? Not where an armed
 * enemy holds out, and not under the guns of a hostile inhabited world.
 */
function maySalvage(game, owner, planet) {
  if (planet.owner && planet.pop >= 0.5 && hostile(game, owner, planet.owner)) return false;
  return !game.fleets.some(f => f.at === planet.id && f.ships.some(s => s.attack > 0) && hostile(game, owner, f.owner));
}

/** Who salvages how much this turn - the same for the forecast as for the turn. */
export function salvagers(game, wreck) {
  const planet = planetById(game, wreck.planetId);
  const owners = new Map();          // owner -> transporter along
  for (const f of game.fleets) {
    if (f.at !== planet.id || !f.ships.length || !playerById(game, f.owner)) continue;
    owners.set(f.owner, owners.get(f.owner) || f.ships.some(s => SHIP_DEFS[s.type]?.cargo));
  }
  return [...owners].filter(([o]) => maySalvage(game, o, planet))
    .map(([owner, transport]) => ({ owner, want: salvageRate(wreck.total, transport) }));
}

/**
 * After the battles, landings and the aliens' turn: every fleet in the
 * orbit of a wreck salvages its share - not in the turn the wreck came
 * about. Is there not enough for everyone, they share by what each could
 * have taken. Empty or old, the wreck is gone.
 */
export function salvageWrecks(game, entries) {
  const list = wrecksOf(game);
  for (const w of list) {
    if (w.born >= game.turn) continue;
    const planet = planetById(game, w.planetId);
    const takers = salvagers(game, w);
    const want = takers.reduce((a, x) => a + x.want, 0);
    if (!want) continue;
    const pool = Math.min(w.metal, want);
    let left = pool;
    const shares = takers.map(x => ({ ...x, got: Math.floor(pool * x.want / want) }));
    left -= shares.reduce((a, x) => a + x.got, 0);
    for (const x of shares) if (left > 0) { x.got++; left--; }
    for (const x of shares) {
      if (x.got <= 0) continue;
      const p = playerById(game, x.owner);
      p.metal += x.got;
      if (p.ledger) p.ledger.salvage += x.got;
      w.metal -= x.got;
    }
    for (const x of shares) {
      if (x.got <= 0) continue;
      entries.push({ type: 'alien', playerIds: [x.owner], private: x.owner, planetId: planet.id,
        key: w.metal > 0 ? 'log.salvaged' : 'log.salvagedAll', params: { planet: planet.name, metal: x.got, left: w.metal } });
    }
  }
  game.wrecks = list.filter(w => {
    if (w.metal <= 0) return false;
    if (game.turn < w.until) return true;
    const planet = planetById(game, w.planetId);
    entries.push({ type: 'alien', playerIds: watchers(game, planet), planetId: planet.id,
      key: 'log.wreckGone', params: { planet: planet.name, metal: w.metal } });
    return false;
  });
}

/**
 * Dev mode: the wreck of a carrier at the levels of the empire right away -
 * at the given world, otherwise at the player's homeworld. Salvageable from
 * the next turn on, as if it had been shot down in this one.
 * @returns {boolean} whether one was placed
 */
export function devWreck(game, player, planetId) {
  let planet = planetId != null ? planetById(game, planetId) : null;
  if (!planet && player) planet = planetById(game, player.homeworld);
  if (!planet) return false;
  const metal = wreckMetal(player?.tech || {});
  const old = wreckAt(game, planet.id);
  if (old) { old.metal += metal; old.total += metal; old.until = game.turn + ALIEN_SPOILS.life; }
  else wrecksOf(game).push({ planetId: planet.id, metal, total: metal, born: game.turn, until: game.turn + ALIEN_SPOILS.life });
  return true;
}
