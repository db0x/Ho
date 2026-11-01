// Alliances between empires: offering, accepting, giving notice, making a
// secret alliance public - and secret alliances giving themselves away to
// whoever sees allied fleets sharing an orbit without a shot fired.
//
// An alliance binds two empires. Allies do not fight each other, share
// what they see and supply each other's fleets from their inhabited worlds.
// Notice ends it NOTICE_TURNS turns later - enough to see it coming, and
// enough to bring fleets into position for whoever plans the betrayal.
import { planetById, playerById } from './game.js';

export const NOTICE_TURNS = 2;
// How long an empire waits before it repeats an offer that was turned down.
export const OFFER_COOLDOWN = 10;
// How long an offer stands without an answer.
export const OFFER_TURNS = 5;

/** The alliance of two empires, active or under notice - or null. */
export function allianceOf(game, a, b) {
  if (!game.alliances.length || a === b) return null;
  return game.alliances.find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a)) || null;
}

/** Do these two empires stand together this turn? Under notice they still do. */
export function allied(game, a, b) {
  const x = allianceOf(game, a, b);
  return !!x && (x.endsAt == null || game.turn < x.endsAt);
}

/** Two different empires that are not allied - they fight where they meet. */
export function hostile(game, a, b) {
  return a !== b && !allied(game, a, b);
}

/** The empires allied with this one. */
export function alliesOf(game, id) {
  if (!game.alliances.length) return [];
  return game.alliances.filter(x => (x.a === id || x.b === id) && allied(game, x.a, x.b))
    .map(x => (x.a === id ? x.b : x.a));
}

/** The empire and its allies - what one of them sees, all of them see. */
export function teamOf(game, id) {
  return [id, ...alliesOf(game, id)];
}

/** Does this empire know of the alliance? Members always, public ones everyone. */
export function knowsAlliance(x, playerId) {
  return playerId == null || x.a === playerId || x.b === playerId || !x.secret || x.knownBy.includes(playerId);
}

/** The partner of an empire in an alliance. */
export function partnerIn(x, id) {
  return x.a === id ? x.b : x.a;
}

/**
 * Offers an alliance. If the other side has already offered one, this is the
 * answer - the alliance stands at once.
 * @returns {undefined | {error: string}}
 */
export function offerAlliance(game, player, toId, secret) {
  const other = playerById(game, toId);
  if (game.settings.alliances === false) return { error: 'err.alliancesOff' };
  if (game.state !== 'running' || !player.alive) return { error: 'err.diplomacyClosed' };
  if (!other || other === player || !other.alive) return { error: 'err.noSuchEmpire' };
  if (allianceOf(game, player.id, other.id)) return { error: 'err.alreadyAllied' };
  const theirs = game.offers.find(o => o.from === other.id && o.to === player.id);
  if (theirs) return answerOffer(game, player, other.id, true);
  game.offers = game.offers.filter(o => !(o.from === player.id && o.to === other.id));
  game.offers.push({ from: player.id, to: other.id, secret: !!secret, turn: game.turn });
}

/** Accepts or turns down an offer that came in. */
export function answerOffer(game, player, fromId, yes) {
  const offer = game.offers.find(o => o.from === fromId && o.to === player.id);
  if (!offer) return { error: 'err.noSuchOffer' };
  game.offers = game.offers.filter(o => o !== offer);
  const from = playerById(game, fromId);
  if (!yes) {
    // Remembered, so nobody keeps asking every turn.
    game.refusals.push({ from: fromId, to: player.id, turn: game.turn });
    tell(game, [fromId], 'log.allianceDeclined', { player: player.name });
    return;
  }
  if (!from?.alive || allianceOf(game, fromId, player.id)) return;
  // Whoever offers decides whether the world may know.
  const x = { a: fromId, b: player.id, since: game.turn, secret: offer.secret, endsAt: null, knownBy: [] };
  game.alliances.push(x);
  game.offers = game.offers.filter(o => !(o.from === player.id && o.to === fromId));
  if (x.secret) tell(game, [x.a, x.b], 'log.allianceSecret', { a: from.name, b: player.name });
  else tell(game, null, 'log.alliance', { a: from.name, b: player.name });
}

/** Takes back an offer that was not answered yet. */
export function withdrawOffer(game, player, toId) {
  game.offers = game.offers.filter(o => !(o.from === player.id && o.to === toId));
}

/** Gives notice: the alliance holds for NOTICE_TURNS more turns, then it is over. */
export function endAlliance(game, player, otherId) {
  const x = allianceOf(game, player.id, otherId);
  if (!x) return { error: 'err.notAllied' };
  if (x.endsAt != null) return;
  x.endsAt = game.turn + NOTICE_TURNS;
  x.by = player.id;
  const other = playerById(game, otherId);
  // Those who knew of it learn that it ends.
  const who = x.secret ? [x.a, x.b, ...x.knownBy] : null;
  tell(game, who, 'log.allianceNotice', { player: player.name, other: other?.name, n: NOTICE_TURNS });
}

/** A secret alliance goes public - either partner may decide that. */
export function announceAlliance(game, player, otherId) {
  const x = allianceOf(game, player.id, otherId);
  if (!x) return { error: 'err.notAllied' };
  if (!x.secret) return;
  x.secret = false;
  x.knownBy = [];
  const other = playerById(game, otherId);
  tell(game, null, 'log.allianceAnnounced', { a: player.name, b: other?.name });
}

/** May `from` offer `to` an alliance again, or was it turned down too recently? */
export function mayOffer(game, from, to) {
  return !allianceOf(game, from, to)
    && !game.offers.some(o => o.from === from && o.to === to)
    && !game.refusals.some(r => r.from === from && r.to === to && game.turn - r.turn < OFFER_COOLDOWN);
}

/**
 * Diplomacy happens during the turn; the log only knows turns. What was
 * agreed goes into the log of the turn in which it happened.
 * @param {string[] | null} playerIds who may read it - null: everyone
 */
function tell(game, playerIds, key, params) {
  game.diplomacyLog.push({ type: 'diplomacy', ...(playerIds ? { playerIds } : {}), key, params });
}

/**
 * At the end of the turn: what was agreed during it goes into the log,
 * alliances whose notice runs out are over, offers to or from empires that
 * are gone lapse.
 */
export function settleDiplomacy(game, entries) {
  entries.push(...game.diplomacyLog);
  game.diplomacyLog = [];
  if (!game.alliances.length && !game.offers.length) return;
  for (const x of game.alliances) {
    const a = playerById(game, x.a), b = playerById(game, x.b);
    const over = (x.endsAt != null && x.endsAt <= game.turn + 1) || !a?.alive || !b?.alive;
    if (!over) continue;
    x.over = true;
    if (a?.alive && b?.alive) {
      entries.push({ type: 'diplomacy', ...(x.secret ? { playerIds: [x.a, x.b, ...x.knownBy] } : {}),
        key: 'log.allianceEnded', params: { a: a.name, b: b.name } });
    }
  }
  game.alliances = game.alliances.filter(x => !x.over);
  const alive = id => playerById(game, id)?.alive;
  game.offers = game.offers.filter(o => alive(o.from) && alive(o.to) && game.turn + 1 - o.turn < OFFER_TURNS);
  game.refusals = game.refusals.filter(r => game.turn - r.turn < OFFER_COOLDOWN);
}

/**
 * Secret alliances give themselves away: whoever sees fleets of both partners
 * in one orbit - or one partner's fleet over the other's world - without a
 * battle, now knows. Only that observer learns it, and their allies see what
 * they see.
 */
export function exposeAlliances(game, entries, visibleFleet) {
  for (const x of game.alliances) {
    if (!x.secret) continue;
    for (const p of game.players) {
      if (!p.alive || p.id === x.a || p.id === x.b || x.knownBy.includes(p.id)) continue;
      const where = evidence(game, x, p, visibleFleet);
      if (!where) continue;
      x.knownBy.push(p.id);
      const a = playerById(game, x.a), b = playerById(game, x.b);
      entries.push({ type: 'diplomacy', playerIds: [p.id], private: p.id, planetId: where.id,
        key: 'log.allianceExposed', params: { a: a.name, b: b.name, planet: where.name } });
    }
  }
}

/** The world where this observer sees the partners stand together, or null. */
function evidence(game, x, p, visibleFleet) {
  const seen = game.fleets.filter(f => f.at != null && f.ships.length
    && (f.owner === x.a || f.owner === x.b) && visibleFleet(game, p.id, f));
  for (const f of seen) {
    const planet = planetById(game, f.at);
    const partner = partnerIn(x, f.owner);
    if (planet.owner === partner && planet.pop > 0 && p.explored.has(planet.id)) return planet;
    if (seen.some(g => g.at === f.at && g.owner === partner)) return planet;
  }
  return null;
}

/**
 * Do all these empires stand together - every one allied with every other,
 * and nobody has given notice? Then they win together.
 */
export function united(game, ids) {
  return ids.length > 1 && ids.every((a, i) => ids.slice(i + 1).every(b => {
    const x = allianceOf(game, a, b);
    return x && x.endsAt == null;
  }));
}

/** What an empire knows about alliances: its own, public ones and those it has seen through. */
export function diplomacyView(game, playerId) {
  const alliances = game.alliances.filter(x => knowsAlliance(x, playerId)).map(x => ({
    a: x.a, b: x.b, since: x.since, secret: x.secret, endsAt: x.endsAt
  }));
  if (playerId == null) return { alliances, offers: [] };
  return {
    alliances,
    offers: game.offers.filter(o => o.from === playerId || o.to === playerId)
      .map(o => ({ from: o.from, to: o.to, secret: o.secret })),
    // Turned down recently: the button waits until it may be asked again.
    refusedBy: game.refusals.filter(r => r.from === playerId)
      .map(r => ({ id: r.to, until: r.turn + OFFER_COOLDOWN }))
  };
}
