// The galaxy grows with exploration, but not without end: at most
// MAX_WORLDS_PER_PLAYER worlds per empire, then it is complete.
import { createGame, addPlayer, startGame, resolveTurn, MAX_WORLDS_PER_PLAYER } from '../server/game.js';

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } };

for (const shape of ['scatter', 'spiral']) {
  const g = createGame('Expand');
  Object.assign(g.settings, { seed: 99, turnTimer: 0, maxTurns: 0, shape });
  addPlayer(g, { name: 'Me' });
  addPlayer(g, { name: 'Other' });
  startGame(g);
  const [me] = g.players;
  const cap = g.players.length * MAX_WORLDS_PER_PLAYER;
  let completes = 0, turns = 0;
  // Every world belongs to one empire: no free land is left and it stands at
  // every border - the map wants to grow every turn.
  for (; turns < 400 && !g.galaxy.complete; turns++) {
    for (const p of g.galaxy.planets) if (p.owner == null) Object.assign(p, { owner: me.id, pop: 5 });
    for (const e of resolveTurn(g)) if (e.key === 'log.galaxyComplete') completes++;
    assert(g.galaxy.planets.length <= cap, `${shape}: ${g.galaxy.planets.length} worlds, more than ${cap}`);
  }
  const at = g.galaxy.planets.length;
  for (let k = 0; k < 20; k++) {
    for (const p of g.galaxy.planets) if (p.owner == null) Object.assign(p, { owner: me.id, pop: 5 });
    for (const e of resolveTurn(g)) if (e.key === 'log.galaxyComplete') completes++;
  }
  assert(g.galaxy.complete, `${shape}: the galaxy never got complete (${at} of ${cap} worlds after ${turns} turns)`);
  assert(g.galaxy.planets.length === at, `${shape}: it kept growing after it was complete`);
  assert(completes === 1, `${shape}: completion announced ${completes} times`);
  console.log(`${shape}: complete after ${turns} turns with ${at} of at most ${cap} worlds.`);
}

if (errors) { console.error(`\n${errors} expansion checks failed.`); process.exit(1); }
console.log('\nAll expansion checks passed.');
