// The memory of an AI empire: what it noticed since its last move - lost
// worlds, approaching fleets, fighting at the neighbors - and, for hard
// empires, what its earlier strikes taught it.
import { planetById } from '../game/game.js';
import { friendly } from './diplomacy.js';
import { PERSONAS } from './personas.js';

/**
 * The memory of an AI empire - it is created on the first move. The variance
 * depends on the seed and the empire, so a game with the same seed plays out
 * the same way.
 */
export function memory(game, bot) {
  if (bot.ai) return bot.ai;
  const template = PERSONAS[bot.persona] || PERSONAS.conqueror;
  let s = 1;
  for (const ch of `${game.settings.seed}:${bot.id}:${bot.name}`) s = (s * 31 + ch.charCodeAt(0)) % 2147483647;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const vary = (v, f) => v * (1 + (rnd() * 2 - 1) * f);
  bot.ai = {
    p: {
      ...template,
      build: vary(template.build, 0.1), terra: vary(template.terra, 0.2),
      fleet: vary(template.fleet, 0.15), margin: vary(template.margin, 0.1),
      from: Math.round(vary(template.from, 0.3)), vengeance: vary(template.vengeance, 0.3)
    },
    grudge: {},             // empire -> how badly it has hurt us
    rival: null,
    campaign: null,
    avoided: {},            // world -> until which turn it is no campaign target
    owned: new Set(),
    holdings: new Map(),    // known enemy world -> owner and population of the previous turn
    fresh: new Map(),       // world -> turn in which it changed owner or collapsed
    lastHit: -99,
    quietSince: game.turn,  // last turn in which a world changed owner
    guard: null,            // threatened world the defenders are currently holding
    // Only used by hard empires: what earlier moves taught them.
    learn: {
      strikes: [],          // attacks under way: fleet, target, owner, strike power
      colonies: [],         // colony ships under way: fleet, target
      world: {},            // world -> { need, since, owner }: firepower that failed there
      foe: {},              // empire -> how much stronger it turned out than estimated
      danger: {},           // world -> until which turn colony ships avoid it
      wins: 0, failures: 0
    }
  };
  return bot.ai;
}

/**
 * What has happened since the last move? Lost worlds stir up a grudge
 * against the new owner, approaching battle fleets a little too.
 * Returns the threatened own worlds with the firepower heading for them.
 */
export function perceive(game, bot, ai, mine, enemyWorlds) {
  const now = new Set(mine.map(p => p.id));
  for (const id of ai.owned) {
    if (now.has(id)) continue;
    const pl = planetById(game, id);
    if (!pl.owner || pl.owner === bot.id) continue;
    ai.grudge[pl.owner] = (ai.grudge[pl.owner] || 0) + 4 + pl.pop / 4;
    ai.lastHit = game.turn;
    ai.quietSince = game.turn;
  }
  for (const id of now) {
    const before = ai.holdings.get(id);
    if (!ai.owned.has(id) && before && before.owner !== bot.id) ai.quietSince = game.turn;
  }
  ai.owned = now;

  const threatened = new Map();
  for (const f of game.fleets) {
    // Allies come as guests - unless notice was given.
    if (f.owner === bot.id || friendly(game, bot, f.owner)) continue;
    const target = f.dest != null ? f.dest : f.at;
    if (target == null || !now.has(target)) continue;
    const fire = f.ships.reduce((a, s) => a + s.attack, 0);
    if (fire <= 0) continue;
    threatened.set(target, (threatened.get(target) || 0) + fire);
    ai.grudge[f.owner] = (ai.grudge[f.owner] || 0) + 0.3;
  }
  for (const k of Object.keys(ai.grudge)) {
    ai.grudge[k] *= 0.97;
    if (ai.grudge[k] < 0.2) delete ai.grudge[k];
  }

  // At the neighbors: changes of ownership and collapsed population - both
  // mean that there has just been fighting there.
  for (const p of enemyWorlds) {
    const old = ai.holdings.get(p.id);
    if (old && (old.owner !== p.owner || p.pop < old.pop * 0.8)) {
      ai.fresh.set(p.id, game.turn);
      if (old.owner !== p.owner) ai.quietSince = Math.max(ai.quietSince, game.turn - 10);
    }
    ai.holdings.set(p.id, { owner: p.owner, pop: p.pop });
  }
  for (const [id, t] of ai.fresh) if (game.turn - t > 6) ai.fresh.delete(id);
  return threatened;
}

/**
 * Every empire learns from its moves. Every strike was noted with what was
 * sent; now that the outcome is known the picture gets corrected:
 * - failed (the fleet is gone, or it sits there and the world is not ours):
 *   this world needs clearly more next time than what just broke on it - no
 *   second wave of the same size against the same wall, that much any
 *   empire sees.
 * Hard empires draw more from it:
 * - taken: the enemy was not stronger than thought - the empire grows bolder
 *   against it, even a little below the plain estimate
 * - failed: its owner is trusted with more strength everywhere.
 * Without new experience the picture drifts back to the plain estimate:
 * caution that only ever grows would end in an empire that never attacks.
 * Colony ships shot down on the way mark their target as dangerous (hard).
 */
const FOE_MIN = 0.85, FOE_MAX = 3;
const FOE_FADE = 0.97;        // per turn, towards the plain estimate

export function review(game, bot, ai, hard) {
  const L = ai.learn;
  L.strikes = L.strikes.filter(s => {
    const world = planetById(game, s.target);
    const fleet = game.fleets.find(f => f.id === s.fleetId && f.owner === bot.id);
    if (world.owner === bot.id) {
      if (hard) L.foe[s.owner] = Math.max(FOE_MIN, (L.foe[s.owner] || 1) * 0.85);
      delete L.world[s.target];
      L.wins++;
      return false;
    }
    if (fleet && fleet.dest === s.target) return game.turn - s.turn < 40;     // still under way
    if (fleet && fleet.at !== s.target) return false;                          // turned elsewhere
    const before = L.world[s.target]?.need || 0;
    L.world[s.target] = { need: Math.max(before, s.strike * 1.7), since: game.turn, owner: world.owner };
    if (hard) L.foe[s.owner] = Math.min(FOE_MAX, (L.foe[s.owner] || 1) * 1.2);
    L.failures++;
    return false;
  });
  // A lesson about a world holds until it changes hands - not just because
  // time passed, that would mean running into the same wall again. Its
  // population is no sign: the failed strikes themselves press it down.
  // Very old lessons go in the end.
  for (const [id, w] of Object.entries(L.world)) {
    const world = planetById(game, Number(id));
    if (!world || world.owner !== w.owner || game.turn - w.since > 150) delete L.world[id];
  }
  for (const [o, f] of Object.entries(L.foe)) {
    const next = 1 + (f - 1) * FOE_FADE;
    if (Math.abs(next - 1) < 0.01) delete L.foe[o]; else L.foe[o] = next;
  }
  L.colonies = L.colonies.filter(c => {
    const world = planetById(game, c.target);
    const fleet = game.fleets.find(f => f.id === c.fleetId && f.owner === bot.id);
    if (world.owner === bot.id) return false;                                  // settled
    if (fleet && fleet.dest === c.target) return true;                         // still under way
    if (!fleet) L.danger[c.target] = game.turn + 20;                           // shot down
    return false;
  });
}
