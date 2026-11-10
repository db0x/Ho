// A player who loses the connection - a phone gone to sleep - must not
// have the turn resolved behind their back. Against the AI alone the game
// waits for them; with others, they count as done only once the others
// have waited ABSENT_GRACE_MS. Ready is ready, the turn timer applies as always.
import { createGame, startGame, allReady, ABSENT_GRACE_MS, someoneAbsent } from '../server/game/game.js';
import { addPlayer } from '../server/game/players.js';

let errors = 0;
const check = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } };

function game(humans) {
  const g = createGame('Absent');
  g.settings.seed = 4;
  for (let i = 0; i < humans; i++) addPlayer(g, { name: 'H' + i });
  addPlayer(g, { isBot: true });
  startGame(g);
  for (const p of g.players) { p.connected = !p.isBot; p.ready = false; }
  return g;
}
const now = Date.now();

// 1) Alone against the AI: the phone sleeps - the game waits, however long.
{
  const g = game(1);
  const [me] = g.players;
  Object.assign(me, { connected: false, lostAt: now });
  check(!allReady(g, now), 'Alone: the turn is resolved the moment the connection drops');
  check(!allReady(g, now + 24 * 3600 * 1000), 'Alone: the turn is resolved after a day without the player');
  check(someoneAbsent(g), 'The absent player is not noticed');
  me.ready = true;
  check(allReady(g, now), 'Alone: ready does not count while away');
}

// 2) With others: the absent one counts as done only after the grace.
{
  const g = game(2);
  const [a, b] = g.players;
  b.ready = true;
  Object.assign(a, { connected: false, lostAt: now });
  check(!allReady(g, now + 1000), 'The turn is resolved a second after the connection dropped');
  check(!allReady(g, now + ABSENT_GRACE_MS - 1000), 'The turn is resolved before the grace is over');
  check(allReady(g, now + ABSENT_GRACE_MS + 1), 'After the grace the others still wait for the absent player');
  // Back in time: plays on as before.
  a.connected = true;
  check(!allReady(g, now + ABSENT_GRACE_MS + 1), 'Back again, the player counts as done without being ready');
  // Nobody connected at all: nobody is waiting.
  Object.assign(a, { connected: false }); Object.assign(b, { connected: false, ready: false, lostAt: now });
  check(!allReady(g, now + ABSENT_GRACE_MS * 10), 'With everybody gone the turn is resolved anyway');
}

if (errors) { console.log(`\n${errors} absence checks failed.`); process.exit(1); }
console.log(`All absence checks passed (grace ${ABSENT_GRACE_MS / 1000} s).`);
