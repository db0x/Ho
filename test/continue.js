// Continuing a finished game: continueGame() itself (bounds, clamping, state
// reset), then the 'continue' message end to end - only the host may send
// it, and the game really keeps playing afterwards.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import {
  createGame, addPlayer, startGame, resolveTurn, continueGame,
  MINIMUM_CONTINUE_TURNS, MAXIMUM_CONTINUE_TURNS
} from '../server/game.js';

let errors = 0;
const fail = (msg) => { console.error('ERROR: ' + msg); errors++; };
const check = (cond, msg) => { if (!cond) fail(msg); };

// --------------------------------------------------------------- continueGame()

{
  const game = createGame('Host');
  Object.assign(game.settings, { maxTurns: 20, turnTimer: 0, planetsPerPlayer: 3 });
  addPlayer(game, { isBot: true, name: 'Bot' });
  startGame(game);
  while (game.state === 'running') resolveTurn(game);
  check(game.state === 'over', 'Game did not end at the turn limit');
  const turnAtEnd = game.turn;

  check(!continueGame({ ...game, state: 'running' }, 30), 'A running game must not be extendable');
  check(!continueGame(game, MINIMUM_CONTINUE_TURNS - 1), 'Too few turns got through');
  check(!continueGame(game, MAXIMUM_CONTINUE_TURNS + 1), 'Too many turns got through');
  check(game.state === 'over', 'A rejected call changed the state anyway');

  check(continueGame(game, 30), 'A number inside the bounds was rejected');
  check(game.state === 'running', 'State did not switch back to running');
  check(game.winner === null, 'The winner was not cleared');
  check(game.players.every(p => !p.ready), 'Ready flags were not reset');
  check(game.settings.maxTurns === turnAtEnd + 30 - 1,
    `maxTurns should be ${turnAtEnd + 30 - 1}, is ${game.settings.maxTurns}`);

  // The 999 ceiling (same one sanitizeSettings uses) still applies.
  game.state = 'over';
  game.turn = 600;         // far enough out that turn + MAXIMUM_CONTINUE_TURNS overshoots 999
  check(continueGame(game, MAXIMUM_CONTINUE_TURNS), 'A valid extension near the ceiling was rejected');
  check(game.settings.maxTurns === 999, `Extension was not clamped to 999, is ${game.settings.maxTurns}`);

  console.log('continueGame(): bounds, clamping and the state reset all hold.');
}

// --------------------------------------------------------------------- Server

const PORT = 8711 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), HO_AUTH: 'off' },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stderr.on('data', d => console.error('[server]', d.toString().trim()));
await new Promise(r => server.stdout.once('data', r));

const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(50); }
  return false;
};
function client() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const c = { ws, view: null, errors: [], code: null };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'hello') resolve(c);
      if (m.t === 'joined') c.code = m.code;
      if (m.t === 'view') c.view = m.view;
      if (m.t === 'error') c.errors.push(m.key);
    });
  });
}
const send = (c, m) => c.ws.send(JSON.stringify(m));

const host = await client(), guest = await client();
send(host, { t: 'create', name: 'Host', settings: { maxTurns: 20, turnTimer: 0, planetsPerPlayer: 3 } });
check(await until(() => host.code, 2000), 'No game code');
send(guest, { t: 'join', code: host.code, name: 'Guest' });
await wait(200);
send(host, { t: 'start' });
check(await until(() => host.view, 2000), 'Game did not start');

for (let i = 0; i < 25 && host.view.state === 'running'; i++) {
  send(host, { t: 'ready', value: true });
  send(guest, { t: 'ready', value: true });
  await wait(180);
}
check(host.view.state === 'over', `Game should have ended at the turn limit, state is ${host.view.state}`);
const turnAtEnd = host.view.turn;

// The guest is not the host - the attempt is refused, the game stays over.
send(guest, { t: 'continue', turns: 30 });
check(await until(() => guest.errors.includes('err.notHostContinue'), 1000),
  'A non-host was allowed to continue the game');
check(host.view.state === 'over', 'Game state changed from a non-host request');

// The host, with a number outside the bounds - refused without an error (the
// dialog itself keeps it in range; the server is the backstop).
send(host, { t: 'continue', turns: MAXIMUM_CONTINUE_TURNS + 1 });
await wait(300);
check(host.view.state === 'over', 'An out-of-range turn count was accepted anyway');

// The host, with a valid number - the game picks back up.
send(host, { t: 'continue', turns: 30 });
check(await until(() => host.view.state === 'running', 1000), 'The host could not continue the game');
check(host.view.maxTurns === turnAtEnd + 30 - 1,
  `maxTurns should be ${turnAtEnd + 30 - 1}, is ${host.view.maxTurns}`);
check(guest.view.state === 'running', 'The guest did not see the game continue');

// It really plays on, not just the state flag.
send(host, { t: 'ready', value: true });
send(guest, { t: 'ready', value: true });
check(await until(() => host.view.turn > turnAtEnd, 1000), 'No further turn was played after continuing');
check(host.view.state === 'running', 'The game ended again right after one more turn');

console.log('Server message \'continue\': host-only, bounds enforced, play resumes for real.');

if (!errors) console.log('\nAll continue checks passed.');
cleanup(errors ? 1 : 0);

function cleanup(code) {
  server.kill();
  process.exit(code);
}
