// The log of the game: what happened each turn. Entries carry a catalog key
// and values - the sentence is assembled in the client, in the player's
// language. Who sees which entry is decided here too.

export function pushLog(game, entries) {
  if (!entries.length) return;
  // Only the latest turn keeps its battle records - nobody needs older
  // ones, and they would travel along with every view.
  for (const l of game.log.slice(-3)) {
    if (l.turn < game.turn) for (const e of l.entries) delete e.battle;
  }
  game.log.push({ turn: game.turn, entries });
  if (game.log.length > 120) game.log.shift();
}

/**
 * A log entry for the client: key and values instead of a finished sentence -
 * the sentence is only assembled there, in the player's language.
 */
export function logEntry(e) {
  const out = {
    type: e.type, planetId: e.planetId ?? null,
    key: e.key, params: e.params, because: e.because
  };
  if (e.at) out.at = e.at;               // a battle in open space
  if (e.battle) out.battle = e.battle;
  return out;
}

/** Everyone sees victories and eliminations; everything else only those involved. */
const PUBLIC_ENTRIES = new Set(['start', 'victory', 'eliminated']);
export function visibleEntry(e, playerId) {
  if (e.private && e.private !== playerId) return false;
  if (PUBLIC_ENTRIES.has(e.type)) return true;
  if (e.playerIds && e.playerIds.length) return e.playerIds.includes(playerId);
  return true;
}
