// Statistics and ranking: only games opened with "new game" are written
// down, each once; walking away from a game puts you behind everyone who
// stayed; beating a hard AI is worth more than beating a normal one; the
// ranking shows names as the friends list does, handles only of friends
// and of oneself; a deleted
// account leaves its games behind without its name.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A separate account file so no real data gets touched.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ho-stats-'));
process.env.HO_USERS_FILE = path.join(dir, 'users.json');
const { addUser, getUser, deleteUser, setPrivacy } = await import('../server/userstore.js');
const friends = await import('../server/friends.js');
const { recordGame, computeRatings, ranking, forget, statsFile, MIN_TURNS, MIN_GAMES } = await import('../server/stats.js');
const { createGame, startGame } = await import('../server/game/game.js');
const { addPlayer } = await import('../server/game/players.js');

let errors = 0;
const check = (cond, msg) => { if (!cond) { console.error('ERROR: ' + msg); errors++; } return cond; };

for (const name of ['alice', 'bob']) await addUser(name, 'statsPassword1', { mustChange: false });
const stored = () => JSON.parse(fs.readFileSync(statsFile(), 'utf8')).games;

/**
 * A game played to its end: `humans` by account, then AI empires of the
 * given levels. `order` names the finishing order by index (first = winner).
 */
function finished({ humans = ['alice'], bots = ['normal'], order, origin = 'custom', turns = 40 }) {
  const g = createGame('');
  g.origin = origin;
  Object.assign(g.settings, { seed: 5, turnTimer: 0 });
  const ps = [
    ...humans.map(a => addPlayer(g, { name: a.toUpperCase(), accountKey: a, account: a })),
    ...bots.map(level => addPlayer(g, { isBot: true, level }))
  ];
  startGame(g);
  g.turn = turns;
  const seq = order || ps.map((_, i) => i);
  seq.forEach((i, rank) => { ps[i].stats.pop = 100 - rank * 10; ps[i].stats.planets = 10 - rank; });
  g.state = 'over';
  g.endReason = 'turnLimit';
  g.winner = ps[seq[0]].id;
  return { g, ps };
}

// 1) Only "new game", only once, and with what matters
{
  const quick = finished({ origin: 'quick' });
  check(recordGame(quick.g) === null, 'The instant game against the AI was recorded');
  const { g } = finished({ bots: ['normal', 'hard'], order: [1, 0, 2] });
  const r = recordGame(g);
  check(r && recordGame(g) === null, 'A game was recorded twice');
  check(stored().length === 1, `${stored().length} games in the file instead of 1`);
  const alice = r.players.find(p => p.account === 'alice');
  check(alice.place === 2 && !alice.winner && r.players.find(p => p.winner).place === 1,
    `Wrong places: ${JSON.stringify(r.players.map(p => [p.name, p.place, p.winner]))}`);
  check(r.end === 'turnLimit' && r.turns === 40 && r.settings.mode && alice.tech && alice.peakPop != null,
    'The record lacks end, turns, settings or the final values');
  check(r.players.filter(p => p.bot).every(p => p.bot.level && p.bot.persona), 'The AI empires lack level or persona');
  console.log('Recorded once, instant games are not.');
}

// 2) Given up: whoever left finishes behind the AI empires still playing -
// even with the biggest empire
{
  const { g, ps } = finished({ humans: ['alice', 'bob'], bots: ['normal'], order: [0, 1, 2] });
  g.state = 'running'; g.winner = null;
  ps[0].leftAt = 30; ps[0].connected = false;
  const r = recordGame(g, { abandoned: true });
  const place = name => r.players.find(p => p.account === name).place;
  check(r.end === 'abandoned', 'Not marked as given up');
  check(place('alice') === 3 && r.players.find(p => p.account === 'alice').left,
    `Alice left with the biggest empire and finished ${place('alice')}`);
  check(place('bob') === 1, `Bob stayed and finished ${place('bob')}`);
  console.log('Whoever leaves finishes last.');
}

// 3) The rating: a win against hard counts more, a short game not at all
{
  const record = (level, won, turns = 40) => finished({ bots: [level], order: won ? [0, 1] : [1, 0], turns }).g;
  const vs = (level, won) => {
    const games = [recordGame(record(level, won))];
    return computeRatings(games).get('alice').rating;
  };
  check(vs('hard', true) > vs('normal', true), 'Beating a hard AI is not worth more than beating a normal one');
  check(vs('hard', false) > vs('normal', false), 'Losing to a hard AI costs as much as losing to a normal one');
  const short = recordGame(record('normal', true, MIN_TURNS - 1));
  check(!computeRatings([short]).has('alice'), 'A game shorter than the minimum was rated');
  console.log('Hard AI weighs more, short games do not count.');
}

// 4) The ranking: from MIN_GAMES on, with profile name - the handle only of
// friends and of oneself
{
  for (let i = 0; i < MIN_GAMES; i++) recordGame(finished({ humans: ['bob'], order: [0, 1] }).g);
  const stranger = ranking('alice').list.find(x => x.name === 'bob');
  check(stranger && stranger.rank >= 1 && stranger.games >= MIN_GAMES, 'Bob is missing from the ranking');
  check(stranger && stranger.handle === null && !stranger.friend, 'A stranger sees the handle of bob');
  check(ranking().list.every(x => x.handle === null), 'Without an account the ranking shows handles');
  check(ranking('alice').me?.handle === getUser('alice').handle, 'The own handle is missing');
  friends.request('alice', 'bob');
  check(ranking('alice').list.find(x => x.name === 'bob')?.handle === null, 'A mere request already reveals the handle');
  friends.answer('bob', 'alice', true);
  const r = ranking('alice');
  const bob = r.list.find(x => x.name === 'bob');
  check(bob?.handle === getUser('bob').handle && bob.friend, 'A friend does not see the handle of bob');
  // Unlisted: gone for everybody else, even friends - the own line stays.
  setPrivacy('bob', { ranking: false });
  check(!ranking('alice').list.some(x => x.name === 'bob'), 'An unlisted account still shows in the ranking');
  check(ranking('alice').list.every((x, i) => x.rank === i + 1), 'The ranks have a gap where the unlisted account was');
  const own = ranking('bob').me;
  check(own?.unlisted && own.rank === null && own.rating > 0, `The unlisted account lost its own line: ${JSON.stringify(own)}`);
  setPrivacy('bob', { ranking: true });
  check(ranking('alice').list.some(x => x.name === 'bob'), 'Listing again does not bring the account back');
  // Shown as everywhere else (friends, games): profile name, else display name.
  check(![...r.list, r.me].some(x => 'account' in x), 'The account itself went out with the ranking');
  check(r.me && r.me.games > 0, 'The own line is missing');
  console.log(`Ranking: ${r.list.length} ranked, own line ${JSON.stringify(r.me)}.`);
}

// 5) Deleting an account: the games stay, its name and account go
{
  deleteUser('bob');
  forget('bob');
  friends.forget('bob');
  const left = stored();
  check(left.length > 0 && !left.some(g => g.players.some(p => p.account === 'bob' || p.name === 'BOB')),
    'Bob is still in the statistics after the account was deleted');
  check(!ranking().list.some(x => x.handle === null && x.name === 'bob'), 'A deleted account still shows in the ranking');
  console.log('A deleted account leaves its games without its name.');
}

fs.rmSync(dir, { recursive: true, force: true });
if (errors) { console.error(`\n${errors} statistics checks failed.`); process.exit(1); }
console.log('\nAll statistics checks passed.');
