// Diplomacy of the AI empires: whom to stand with, whom to turn down, when
// to show an alliance off - and when to drop an ally. The character decides
// (personas.js: trust, secrecy, loyalty); the situation tips the scales.
//
// What it amounts to in play:
// - the enemy of my enemy: a front-runner or a common rival brings empires
//   together; the weak seek protection
// - nobody allies with the empire that hurt it, with its rival, or with
//   whoever stands with its rival
// - an ally under attack is defended: its attacker earns a grudge
// - a public alliance deters - a defender's known allies count when the
//   price of a world is reckoned (situation.js)
// - betrayal: a disloyal empire drops an ally that leads, that lies on the
//   ground, or that it simply needs as prey late in the game. A hard one
//   first moves its fleets into the ally's orbit as guests, gives notice
//   once they are in place, and the battle starts inside the defenses.
import { dist, clamp } from '../../shared/rules.js';
import { perceivedPlanets, popOf } from './perception.js';
import {
  allianceOf, offerAlliance, answerOffer, endAlliance, announceAlliance, mayOffer, knowsAlliance,
  partnerIn, alliesOf, NOTICE_TURNS
} from '../game/diplomacy.js';
import { fleetStats } from '../game/fleets.js';
import { playerById } from '../game/game.js';
import { memory } from './memory.js';
import { BATTERED } from './situation.js';

// Above this appeal an offer is accepted; above the second, made.
const ACCEPT = 1.6, PROPOSE = 2.3;
// Turns between two offers of the same empire - nobody likes a pest. Every
// refusal makes it wait longer, and the one who refused is not asked again
// for a long time.
const OFFER_GAP = 8, REFUSED_FOR = 40;
// An alliance is kept at least this long before betrayal is considered.
const SETTLE_IN = 12;

/**
 * An ally to rely on: allied, nobody has given notice, and this empire is
 * not plotting against it. Everything else counts as a possible enemy in
 * war planning.
 */
export function friendly(game, bot, id) {
  const x = allianceOf(game, bot.id, id);
  return !!x && x.endsAt == null && bot.ai?.plot?.id !== id;
}

/** The allies of an empire that `bot` knows of. */
export function knownAllies(game, bot, id) {
  return game.alliances.filter(x => (x.a === id || x.b === id) && knowsAlliance(x, bot.id))
    .map(x => partnerIn(x, id));
}

/**
 * The view on the other empires: who leads, who is weak, how close each one
 * lives. Needs no full situation report - offers get answered at any time.
 */
function outlook(game, bot) {
  const ai = memory(game, bot);
  const living = game.players.filter(p => p.alive);
  // With fog of war: sizes and owners only as far as this empire knows them.
  const planets = perceivedPlanets(game, bot);
  const popBy = popOf(game, bot, planets);
  const totalPop = living.reduce((a, p) => a + popBy(p.id), 0) || 1;
  const share = id => popBy(id) / totalPop;
  const top = living.slice().sort((a, b) => popBy(b.id) - popBy(a.id))[0];
  const leader = top && popBy(top.id) / totalPop > 0.25 && living.length > 2 ? top.id : null;
  // How close the nearest known world of each empire is to our biggest ones.
  const mine = game.galaxy.planets.filter(p => p.owner === bot.id && p.pop >= 0.5)
    .sort((a, b) => b.pop - a.pop).slice(0, 12);
  const near = new Map();
  for (const p of planets) {
    if (!p.owner || p.owner === bot.id || !bot.explored.has(p.id)) continue;
    let d = near.get(p.owner) ?? Infinity;
    for (const q of mine) d = Math.min(d, dist(p, q));
    near.set(p.owner, d);
  }
  return { ai, P: ai.p, living, share, leader, near, planets };
}

/** How much this empire wants an alliance with `id` - above ACCEPT it says yes. */
function appeal(game, bot, o, id) {
  const { ai, P, living, share, leader, near } = o;
  const other = playerById(game, id);
  if (!other?.alive || id === bot.id) return -Infinity;
  // Two left: an alliance ends the game in a shared victory. Only whoever is
  // losing wants that.
  if (living.length <= 2) return share(bot.id) < 0.35 ? ACCEPT + 1 : -9;
  if (ai.betrayedBy?.[id]) return -9;                       // once bitten
  let v = P.trust * 2;
  v -= (ai.grudge[id] || 0) * 0.4;                           // whoever hurt us is not trusted
  if (id === ai.rival) v -= 2.5;
  if (id === leader) v -= 1.5 * P.vsLeader + 0.5;            // nobody helps the front-runner grow
  else if (leader && leader !== bot.id) v += 1.2;            // the enemy of my enemy
  if (share(bot.id) < 0.7 / living.length) v += 1;           // the weak seek protection
  // A neighbor: an alliance secures the border - unless it is the prey.
  if ((near.get(id) ?? Infinity) < 450) v += P.campaign === 'always' && P.solo === 'prey' ? -1 : 0.8;
  for (const y of knownAllies(game, bot, id)) {
    if (y === ai.rival || (ai.grudge[y] || 0) > 3) v -= 2;   // stands with our enemy
    else if (friendly(game, bot, y)) v += 0.5;               // a friend of a friend
  }
  // Not everybody's friend: with every ally, a shared victory comes closer
  // and there is less left to take.
  v -= 0.8 * alliesOf(game, bot.id).length;
  return v;
}

/** Answers every offer that came in - right away, nobody is kept waiting. */
export function answerOffers(game, bot) {
  if (game.settings.alliances === false) return;
  const offers = game.offers.filter(x => x.to === bot.id);
  if (!offers.length) return;
  const o = outlook(game, bot);
  for (const x of offers) answerOffer(game, bot, x.from, appeal(game, bot, o, x.from) >= ACCEPT);
}

/**
 * The diplomacy of a move: answer offers, notice what allies went through,
 * make an offer of its own, show an alliance off - or drop an ally.
 */
export function diplomacy(s) {
  const { game, bot } = s;
  if (game.settings.alliances === false) return;
  answerOffers(game, bot);
  const o = outlook(game, bot);
  watchAllies(s, o);
  if (o.living.length <= 2) return;
  propose(s, o);
  announce(s);
  reconsider(s, o);
}

/**
 * Notices given to us and attacks on our allies. Whoever drops us is
 * remembered for good; whoever takes an ally's world takes it from us too.
 */
function watchAllies(s, o) {
  const { game, bot } = s;
  const { ai, P } = o;
  ai.betrayedBy ||= {};
  for (const x of game.alliances) {
    if ((x.a !== bot.id && x.b !== bot.id) || x.endsAt == null || x.by === bot.id) continue;
    const id = partnerIn(x, bot.id);
    if (ai.betrayedBy[id]) continue;
    ai.betrayedBy[id] = game.turn;
    ai.grudge[id] = (ai.grudge[id] || 0) + 6;
    ai.lastHit = game.turn;
  }
  // What allies held last turn - lost to an enemy, it stirs a grudge.
  const held = ai.allyWorlds || new Map();
  const now = new Map();
  for (const p of o.planets) {
    const was = held.get(p.id);
    if (p.owner && friendly(game, bot, p.owner)) now.set(p.id, p.owner);
    if (was && p.owner && p.owner !== was && p.owner !== bot.id && !friendly(game, bot, p.owner)) {
      ai.grudge[p.owner] = (ai.grudge[p.owner] || 0) + 1.5 + 2 * P.loyalty;
    }
  }
  ai.allyWorlds = now;
}

/** Offers an alliance to the empire it wants most - if it wants it enough. */
function propose(s, o) {
  const { game, bot } = s;
  const { ai, P } = o;
  ai.refused ||= {};
  for (const r of game.refusals) if (r.from === bot.id && r.turn === game.turn - 1) ai.refused[r.to] = r.turn;
  const snubs = Object.values(ai.refused).filter(t => game.turn - t < REFUSED_FOR).length;
  if (game.turn < 8 || game.turn - (ai.offered ?? -99) < OFFER_GAP * (1 + snubs)) return;
  let best = null;
  for (const p of o.living) {
    if (p.id === bot.id || !mayOffer(game, bot.id, p.id) || game.turn - (ai.refused[p.id] ?? -99) < REFUSED_FOR) continue;
    const v = appeal(game, bot, o, p.id);
    if (v >= PROPOSE && (!best || v > best.v)) best = { id: p.id, v };
  }
  if (!best) return;
  ai.offered = game.turn;
  offerAlliance(game, bot, best.id, P.secrecy >= 0.5);
  // Another AI answers right away, as with an offer from a human.
  const other = playerById(game, best.id);
  if (other.isBot) answerOffers(game, other);
}

/**
 * A secret alliance goes public when it would deter: this empire is
 * threatened, and its character prefers to show its friends.
 */
function announce(s) {
  const { game, bot, P, threatened } = s;
  if (P.secrecy >= 0.5 || !threatened.size) return;
  for (const x of game.alliances) {
    if (x.secret && x.endsAt == null && (x.a === bot.id || x.b === bot.id)) {
      announceAlliance(game, bot, partnerIn(x, bot.id));
    }
  }
}

/**
 * Betrayal. The disloyal drop an ally that leads, that lies on the ground,
 * or late in the game simply because there is not much left to take. A
 * normal empire gives notice and attacks once it has run out; a hard one
 * plots first - its fleets move into the ally's orbit as guests, and notice
 * comes once they sit there.
 */
function reconsider(s, o) {
  const { game, bot, ai, hard, pressure, worldsLeft, myFleets } = s;
  const { P, leader } = o;
  // A plot whose alliance is gone is done; one that dragged on too long is
  // given up - the alliance simply goes on.
  if (ai.plot && (!allianceOf(game, bot.id, ai.plot.id) || game.turn - ai.plot.since > 30)) ai.plot = null;
  for (const x of game.alliances) {
    if ((x.a !== bot.id && x.b !== bot.id) || x.endsAt != null) continue;
    const id = partnerIn(x, bot.id);
    if (game.turn - x.since < SETTLE_IN) continue;
    let urge = pressure * 1.5 + (ai.grudge[id] || 0) * 0.3;
    if (id === leader) urge += 1.2 + P.vsLeader;
    if ((worldsLeft.get(id) ?? countWorlds(o.planets, bot, id)) <= BATTERED) urge += 1.2;
    urge *= clamp(1 - P.loyalty, 0, 1);
    // A plot under way is seen through - the mood of a turn does not stop it.
    if (urge < 1.2 && ai.plot?.id !== id) continue;
    if (!hard) { endAlliance(game, bot, id); continue; }
    // Hard: the plot. War planning treats the ally as an enemy from now on
    // (friendly() says no), so the campaign sends fleets there - as guests.
    // Only an ally within reach of the fighters is worth the plot. The
    // campaign under way is dropped: the next one is planned against the ally.
    if (!ai.plot) {
      const near = o.planets.some(p => p.owner === id && bot.explored.has(p.id)
        && s.bases.some(b => dist(b, p) <= s.fighter.range));
      if (near) { ai.plot = { id, since: game.turn }; ai.campaign = null; }
      continue;
    }
    if (ai.plot.id !== id) continue;
    // Notice once enough firepower sits in the ally's orbit, or will
    // before the notice runs out.
    const goal = s.camp?.target;
    if (!goal || goal.owner !== id) continue;
    const there = myFleets.filter(f => f.at === goal.id
      || (f.dest === goal.id && dist(f, goal) <= fleetStats(f).speed * NOTICE_TURNS));
    const fire = there.reduce((a, f) => a + s.strikePower(f), 0);
    if (fire >= s.camp.cost * s.margin) endAlliance(game, bot, id);
  }
}

/** Known worlds of an empire, when the situation report has not counted them. */
function countWorlds(planets, bot, id) {
  return planets.filter(p => p.owner === id && bot.explored.has(p.id)).length;
}
