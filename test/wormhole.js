// Wormholes: the mouths lie far apart and clear of worlds and the black
// hole, an empire only sees what its scanners reach, learns where a mouth
// leads by jumping - and can only travel on the far side as long as the
// wormhole carries the supply. Without it, there is no flying into the unknown.
import { createGame, addPlayer, startGame, resolveTurn, setOrders, canReach, buildView } from '../server/game.js';
import { runBot } from '../server/bot.js';
import { openWormhole, devWormholes, findMouth } from '../server/wormholes.js';
import { WORMHOLE, holeZone, dist } from '../shared/rules.js';

let errors = 0;
const check = (ok, text) => { if (!ok) { console.log('  FAIL ' + text); errors++; } };

// ------------------------------------------------------------ Placement
for (const shape of ['scatter', 'spiral']) {
  const game = createGame('Holes');
  game.settings.seed = 'wormhole-' + shape;
  game.settings.shape = shape;
  for (let i = 0; i < 8; i++) addPlayer(game, { isBot: true });
  startGame(game);
  const g = game.galaxy;
  const span = WORMHOLE.span * Math.max(g.maxX - g.minX, g.maxY - g.minY);
  const zone = holeZone(g);
  let opened = 0, shortest = Infinity;
  for (let i = 0; i < 12; i++) {
    const hole = openWormhole(game);
    if (!hole) continue;
    opened++;
    const [a, b] = hole.mouths;
    shortest = Math.min(shortest, dist(a, b));
    check(a.id !== b.id, 'two mouths, two ids');
    for (const m of hole.mouths) {
      for (const p of g.planets) check(dist(m, p) >= WORMHOLE.clearance, `mouth ${m.id} too close to ${p.name}`);
      if (zone) check(dist(m, zone) > zone.r, `mouth ${m.id} inside the black hole's zone`);
    }
  }
  check(opened >= 2, `${shape}: only ${opened} wormholes found room`);
  check(shortest >= span * 0.6, `${shape}: mouths only ${Math.round(shortest)} ly apart (span ${Math.round(span)})`);
  console.log(`${shape}: ${opened} wormholes, mouths at least ${Math.round(shortest)} ly apart (span ${Math.round(span)} ly).`);
}

// ------------------------------------------------------- Jump and supply
{
  const game = createGame('Jump');
  game.settings.seed = 'wormhole-jump';
  game.settings.wormholes = false;              // no random ones in between
  const me = addPlayer(game, { name: 'Tester' });
  addPlayer(game, { isBot: true });
  startGame(game);
  const home = game.galaxy.planets[me.homeworld];
  const scouts = game.fleets.find(f => f.owner === me.id && f.ships.every(s => s.type === 'scout'));

  // Opened next to the homeworld: the near end is seen, the far one is not.
  check(devWormholes(game, me, 'open', home), 'opening a wormhole next to the homeworld');
  const hole = game.wormholes[0];
  const [near, far] = hole.mouths;
  let view = buildView(game, me);
  check(view.wormholes.length === 1 && view.wormholes[0].id === near.id, 'only the near mouth is in sight');
  check(view.wormholes[0].link === null, 'where it leads is unknown before the jump');
  check(!JSON.stringify(view).includes(far.id), 'the far mouth does not leak into the view');

  // Orders: never to a mouth not seen, and the far side is no target from home.
  check(setOrders(game, me, { move: { fleetId: scouts.id, hole: far.id } })?.error === 'err.noSuchHole',
    'a mouth not seen cannot be targeted');
  const beyond = game.galaxy.planets.filter(p => dist(p, far) < 250).sort((a, b) => dist(a, far) - dist(b, far))[0];
  check(beyond && !canReach(game, scouts, beyond).ok, 'a world beyond the wormhole is out of reach from home');

  check(!setOrders(game, me, { move: { fleetId: scouts.id, hole: near.id } }), 'course into the near mouth');
  check(scouts.hole === near.id && scouts.dest == null, 'the course is set on the mouth');
  for (let t = 0; t < 10 && scouts.hole; t++) { me.ready = true; resolveTurn(game); }
  check(!scouts.hole && scouts.at == null, 'the fleet has jumped');
  check(dist(scouts, far) < 1, `the fleet came out of the far mouth (${Math.round(dist(scouts, far))} ly away)`);
  check(me.knownHoles.has(hole.id), 'both ends are known now');
  view = buildView(game, me);
  check(view.wormholes.find(m => m.id === near.id)?.link === far.id, 'the view shows where it leads');
  check(game.log.some(l => l.entries.some(e => e.key === 'log.holeJump' && e.private === me.id)), 'the jump is in the log');

  // On the far side the wormhole carries the supply ...
  if (beyond) {
    check(canReach(game, scouts, beyond).ok, 'beyond the wormhole the fleet may fly on while it is open');
    // ... but a fleet at home still cannot fly straight there.
    const stay = game.fleets.find(f => f.owner === me.id && f !== scouts && f.at === home.id);
    if (stay) check(!canReach(game, stay, beyond).ok, 'from home there is no straight way into the far side');
  }
  // The way back: into the far mouth, out at home.
  check(canReach(game, scouts, far).ok, 'the way back through the wormhole is open');

  // Collapse: afterwards the far side is cut off.
  devWormholes(game, me, 'close');
  check(!game.wormholes.length && !me.knownHoles.size, 'closed and forgotten');
  if (beyond) check(!canReach(game, scouts, beyond).ok, 'once collapsed, the fleet beyond is cut off');
  check(buildView(game, me).wormholes.length === 0, 'the view no longer shows it');
}

// --------------------------------------------- Collapse while en route
{
  const game = createGame('Collapse');
  game.settings.seed = 'wormhole-collapse';
  game.settings.wormholes = false;
  const me = addPlayer(game, { name: 'Tester' });
  addPlayer(game, { isBot: true });
  startGame(game);
  const home = game.galaxy.planets[me.homeworld];
  const settlers = game.fleets.find(f => f.owner === me.id && f.ships.some(s => s.type === 'colony'));
  devWormholes(game, me, 'open', home);
  const hole = game.wormholes[0];
  setOrders(game, me, { move: { fleetId: settlers.id, hole: hole.mouths[0].id } });
  hole.closes = game.turn;                        // collapses as this turn resolves
  const far = dist(settlers, hole.mouths[0]) > settlers.ships[0].speed;
  me.ready = true;
  resolveTurn(game);
  check(!game.wormholes.length, 'the wormhole collapsed on time');
  if (far) {
    check(settlers.hole == null, 'the fleet heading for it stopped');
    check(game.log.at(-1).entries.some(e => e.key === 'log.holeLost'), 'and was told why');
  }
  check(findMouth(game, hole.mouths[0].id) === null, 'its mouths are gone');
}

// ------------------------------------------------ Long game with bots
{
  const game = createGame('Long');
  game.settings.seed = 'wormhole-long';
  game.settings.shape = 'spiral';
  game.settings.mode = 'space';
  for (let i = 0; i < 10; i++) addPlayer(game, { isBot: true });
  startGame(game);
  const seen = new Set();
  let maxOpen = 0, jumps = 0;
  const jumpers = new Set();
  for (let t = 0; t < 120 && game.state === 'running'; t++) {
    for (const b of game.players.filter(p => p.isBot && p.alive)) runBot(game, b);
    resolveTurn(game);
    for (const e of game.log.at(-1)?.entries || []) {
      if (e.key !== 'log.holeJump') continue;
      jumps++;
      jumpers.add(game.players.find(p => p.id === e.private)?.persona);
    }
    for (const h of game.wormholes) {
      seen.add(h.id);
      check(h.opened >= WORMHOLE.firstTurn, `wormhole ${h.id} opened too early (turn ${h.opened})`);
      check(h.closes - h.opened <= WORMHOLE.life[1], `wormhole ${h.id} lives too long`);
    }
    maxOpen = Math.max(maxOpen, game.wormholes.length);
    check(game.wormholes.length <= WORMHOLE.max, 'too many wormholes at once');
    for (const p of game.players) for (const id of p.seenMouths) check(findMouth(game, id), `${p.name} remembers a mouth that is gone`);
  }
  check(seen.size >= 2, `only ${seen.size} wormholes in 120 turns`);
  // Curious AI personalities use them; the others leave them alone.
  check(jumps >= 2, `the AI jumped only ${jumps} times`);
  check([...jumpers].every(k => ['settler', 'raider', 'vulture'].includes(k)), `unexpected jumpers: ${[...jumpers]}`);
  console.log(`Long game: ${seen.size} wormholes in ${game.turn - 1} turns, at most ${maxOpen} at once; `
    + `${jumps} AI jumps (${[...jumpers].join(', ')}).`);
}

if (errors) { console.error(`\n${errors} wormhole checks failed.`); process.exit(1); }
console.log('\nAll wormhole checks passed.');
