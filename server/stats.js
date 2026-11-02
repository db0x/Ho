// Game statistics and the ranking of this instance.
//
// Every game opened with "new game" is written down once it is decided -
// or given up. What is stored are plain facts per game and empire: who
// played, how it ended, where everyone finished and with how much. The
// ranking is derived from them every time, so the way of scoring can change
// later without losing a single game.
//
// Only games opened in the lobby count; the instant game against the AI is
// practice. A game is written down once: when it is first decided, or when it
// is given up - whoever leaves before the end finishes behind everyone who
// stayed, so walking away from a lost game does not save the rating.
//
// Stored by account name next to the account file, like friends.json. The
// ranking shows names the way the friends list does - the handle only of
// friends and of oneself: whoever has it can send a friend request, and
// a ranking must not hand out everybody's.
// A deleted account leaves its games behind, but without name and account:
// for the others they stay as they were played.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { relation } from './friends.js';
import { accountAvatarUrl } from './profile.js';
import { userFile, getUser, displayName } from './userstore.js';
import { VERSION } from './hub/news.js';

// Games shorter than this were hardly played - a start by mistake, a test.
export const MIN_TURNS = 10;
// Only from this many rated games on does an account get a rank.
export const MIN_GAMES = 3;
export const START_RATING = 1000;
// The AI empires do not learn between games: their rating stays put.
// Guests without an account count like a normal AI.
export const BOT_RATING = { normal: 1000, hard: 1200 };
const K = 32;

export function statsFile() {
  return path.join(path.dirname(userFile()), 'stats.json');
}

let db = null;
let dbFile = null;
let board = null;                 // the computed ranking until the next game

function empty() { return { version: 1, games: [] }; }

function data() {
  // Tests point HO_USERS_FILE elsewhere - then the statistics follow.
  if (db && dbFile === statsFile()) return db;
  dbFile = statsFile();
  board = null;
  try {
    db = { ...empty(), ...JSON.parse(fs.readFileSync(dbFile, 'utf8')) };
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`stats.json is unreadable (${dbFile}): ${e.message}`);
    db = empty();
  }
  return db;
}

function save() {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const tmp = `${dbFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, dbFile);
  board = null;
}

/**
 * Where everyone finished. Winners share first place; then whoever is
 * still in, by population; then the eliminated, the later the better; and
 * last whoever left - the earlier, the further back.
 */
function placings(game, left) {
  const winners = new Set(game.winners || (game.winner ? [game.winner] : []));
  const group = p => (winners.has(p.id) ? 0 : left(p) ? 3 : p.alive ? 1 : 2);
  const sorted = game.players.slice().sort((a, b) => group(a) - group(b)
    || (group(a) === 1 ? b.stats.pop - a.stats.pop : 0)
    || (group(a) === 2 ? (b.outAt || 0) - (a.outAt || 0) : 0)
    || (group(a) === 3 ? (b.leftAt ?? 0) - (a.leftAt ?? 0) : 0));
  const place = new Map();
  sorted.forEach((p, i) => place.set(p.id, group(p) === 0 ? 1 : i + 1));
  return place;
}

/**
 * Writes a game down - once. `abandoned`: nobody plays it to the end; then
 * every human who is no longer at the table counts as having left.
 * Returns the record, or null if the game does not count.
 */
export function recordGame(game, { abandoned = false } = {}) {
  if (game.recorded || game.origin !== 'custom' || !game.galaxy) return null;
  if (!game.players.some(p => !p.isBot)) return null;
  game.recorded = true;
  const left = p => !p.isBot && (p.leftAt != null || (abandoned && !p.connected));
  const place = placings(game, left);
  const winners = new Set(game.winners || (game.winner ? [game.winner] : []));
  const s = game.settings;
  const record = {
    id: crypto.randomUUID(),
    version: VERSION,
    code: game.id,
    startedAt: game.startedAt || game.created,
    endedAt: Date.now(),
    turns: game.turn,
    end: abandoned ? 'abandoned' : game.endReason || 'turnLimit',
    settings: {
      mode: s.mode, shape: s.shape, maxTurns: s.maxTurns, planetsPerPlayer: s.planetsPerPlayer,
      startMoney: s.startMoney, startMetal: s.startMetal, turnTimer: s.turnTimer,
      expanding: s.expanding !== false, wormholes: !!s.wormholes, alliances: s.alliances !== false,
      capitalShips: s.capitalShips !== false
    },
    players: game.players.map(p => ({
      account: p.isBot ? null : p.accountKey || null,
      name: p.name,
      bot: p.isBot ? { persona: p.persona, level: p.level } : null,
      place: place.get(p.id),
      winner: winners.has(p.id),
      alive: p.alive,
      outAt: p.outAt ?? null,
      left: left(p),
      leftAt: p.leftAt ?? null,
      planets: p.stats.planets, pop: p.stats.pop, ships: p.stats.ships,
      kills: p.stats.kills, losses: p.stats.losses,
      peakPlanets: p.stats.peakPlanets ?? p.stats.planets, peakPop: p.stats.peakPop ?? p.stats.pop,
      tech: { ...p.tech }
    }))
  };
  data().games.push(record);
  save();
  return record;
}

/** Does this game count for the ranking? */
export function rated(record) {
  return record.turns >= MIN_TURNS && record.players.some(p => p.account);
}

/**
 * Elo for many at once: every empire is compared with every other one in
 * the same game - finished ahead counts as a win, behind as a loss, the
 * same place as a draw. The changes are worked out from the ratings before
 * the game and spread over the number of opponents, so a game of sixteen
 * weighs no more than a duel.
 */
export function computeRatings(games) {
  const accounts = new Map();     // account -> { rating, games, wins, places, last }
  const entry = a => {
    if (!accounts.has(a)) accounts.set(a, { rating: START_RATING, games: 0, wins: 0, podium: 0, last: 0 });
    return accounts.get(a);
  };
  for (const g of games) {
    if (!rated(g)) continue;
    const ps = g.players;
    const before = ps.map(p => (p.account ? entry(p.account).rating : BOT_RATING[p.bot?.level] ?? START_RATING));
    const n = ps.length;
    ps.forEach((p, i) => {
      if (!p.account) return;
      const a = entry(p.account);
      let delta = 0;
      ps.forEach((q, j) => {
        if (i === j) return;
        const score = p.place < q.place ? 1 : p.place > q.place ? 0 : 0.5;
        const expected = 1 / (1 + 10 ** ((before[j] - before[i]) / 400));
        delta += score - expected;
      });
      a.rating += n > 1 ? K * delta / (n - 1) : 0;
      a.games++;
      if (p.winner) a.wins++;
      if (p.place <= 3 && n > 3) a.podium++;
      a.last = Math.max(a.last, g.endedAt);
    });
  }
  return accounts;
}

/**
 * The ranking as it goes out: profile name, never the account name - and
 * the handle only where `me` knows it anyway: its own and its friends'.
 * Accounts that no longer exist drop out, and so do those that do not want
 * to be listed - their games still count for everybody else's rating, only
 * their own line is shown to nobody but themselves. `me` additionally gets
 * the own line, even before it has a rank.
 */
export function ranking(me = null) {
  if (!board) {
    const all = [...computeRatings(data().games)]
      .map(([account, a]) => ({ account, ...a, rating: Math.round(a.rating) }))
      .filter(x => getUser(x.account));
    board = {
      ranked: all.filter(x => x.games >= MIN_GAMES).sort((a, b) => b.rating - a.rating || b.wins - a.wins),
      byAccount: new Map(all.map(x => [x.account, x]))
    };
  }
  const show = (x, rank) => {
    const u = getUser(x.account);
    const rel = me ? relation(me, x.account) : 'none';
    const known = rel === 'self' || rel === 'friends';
    return {
      rank, name: u?.nick || displayName(x.account, u), handle: known ? u?.handle || null : null,
      friend: rel === 'friends', avatar: accountAvatarUrl(x.account),
      rating: x.rating, games: x.games, wins: x.wins, podium: x.podium, last: x.last
    };
  };
  const listed = board.ranked.filter(x => !getUser(x.account)?.unlisted);
  const list = listed.map((x, i) => ({ ...show(x, i + 1), me: x.account === me }));
  const own = me && board.byAccount.get(me);
  const rank = own && listed.includes(own) ? listed.indexOf(own) + 1 : null;
  return {
    list, minGames: MIN_GAMES, minTurns: MIN_TURNS,
    me: own ? { ...show(own, rank), unlisted: !!getUser(me)?.unlisted } : null
  };
}

/** A deleted account: its games stay, but without its name. */
export function forget(account) {
  let changed = false;
  for (const g of data().games) {
    for (const p of g.players) {
      if (p.account === account) { p.account = null; p.name = null; changed = true; }
    }
  }
  if (changed) save();
}
