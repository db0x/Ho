// The black hole as a game element: in a spiral galaxy no fleet may fly
// through the exclusion zone or stop inside it - not even between two turns
// when it is just passing by.
import { createGame, addPlayer, startGame, resolveTurn } from '../server/game.js';
import { runBot } from '../server/bot.js';
import { holeZone, route, routeLength, blocked, dist, travelDistance, reachOutline } from '../shared/rules.js';

const game = createGame('Hole');
game.settings.seed = 20251015;
game.settings.turnTimer = 0;
game.settings.shape = 'spiral';
for (let i = 0; i < 12; i++) addPlayer(game, { isBot: true, name: 'AI ' + (i + 1) });
const r = startGame(game);
if (r.error) throw new Error(r.error);

const zone = holeZone(game.galaxy);
if (!zone) throw new Error('Spiral galaxy without a black hole');
console.log(`Galaxy: ${game.galaxy.planets.length} worlds, hole "${game.galaxy.blackHole.name}" `
  + `with exclusion zone ${Math.round(zone.r)} ly`);

// No world may lie inside the zone - otherwise a target would be unreachable.
const clearance = (list) => list.reduce(
  (b, p) => Math.min(b, dist(p, zone) - zone.r), Infinity);
for (const p of game.galaxy.planets) {
  if (dist(p, zone) < zone.r) throw new Error(`World ${p.name} lies inside the exclusion zone`);
}
console.log(`Nearest world lies ${clearance(game.galaxy.planets).toFixed(0)} ly outside the border.`);

let errors = 0, detours = 0, closest = Infinity;
const TURNS = 100;

for (let t = 0; t < TURNS && game.state === 'running'; t++) {
  for (const b of game.players.filter(p => p.isBot && p.alive)) runBot(game, b);
  resolveTurn(game);

  for (const f of game.fleets) {
    const d = dist(f, zone);
    closest = Math.min(closest, d);
    if (d < zone.r - 1e-6) {
      console.log(`Fleet ${f.id} is inside the exclusion zone (${d.toFixed(1)} < ${zone.r})`);
      errors++;
    }
    if (f.dest != null) {
      const target = game.galaxy.planets.find(p => p.id === f.dest);
      if (!target) continue;
      // Straight line blocked means: the course has to go around the outside.
      if (blocked(f, target, zone)) detours++;
      // And every piece of the planned path has to stay outside.
      let prev = f;
      for (const w of route(f, target, zone)) {
        if (blocked(prev, w, zone)) {
          console.log(`Course of fleet ${f.id} crosses the exclusion zone`);
          errors++;
          break;
        }
        prev = w;
      }
    }
  }
  // No world inside the zone, not even after the galaxy has grown
  for (const p of game.galaxy.planets) {
    if (dist(p, zone) < zone.r) { console.log(`New world ${p.name} inside the exclusion zone`); errors++; }
  }
}

console.log(`${TURNS} turns played, closest pass: ${closest.toFixed(1)} ly `
  + `(border ${zone.r.toFixed(1)}), ${detours} courses routed around the hole.`);

// The drawn range outline must match the server's decision: whatever lies
// inside is flyable - whatever lies just outside is not.
{
  const base = game.galaxy.planets.find(p => p.owner) || game.galaxy.planets[0];
  const range = 400;
  const outline = reachOutline(base, range, zone);
  let inside = 0, beyond = 0;
  for (const q of outline) {
    const d = travelDistance(base, q, zone);
    if (d > range + 1) { beyond++; continue; }
    inside++;
    // A little further out it has to tip over, otherwise the outline is too tight.
    const dx = q.x - base.x, dy = q.y - base.y;
    const length = Math.hypot(dx, dy) || 1;
    const further = { x: base.x + dx / length * (length + 6), y: base.y + dy / length * (length + 6), z: q.z };
    if (travelDistance(base, further, zone) <= range) {
      console.log(`Outline too tight: ${Math.round(travelDistance(base, further, zone))} <= ${range}`);
      errors++;
      break;
    }
  }
  if (beyond) { console.log(`${beyond} outline points lie beyond the range`); errors++; }
  console.log(`Range outline: ${inside} points, all flyable and at the edge.`);
}

// And the detour must really be longer than the straight line.
const a = { x: zone.x - 600, y: zone.y, z: 0 };
const b = { x: zone.x + 600, y: zone.y, z: 0 };
const detour = routeLength(a, route(a, b, zone));
if (!(detour > dist(a, b))) { console.log('Detour is not longer than the straight line'); errors++; }
console.log(`Straight across the hole: ${Math.round(detour)} instead of ${Math.round(dist(a, b))} ly.`);

if (errors) { console.error(`\n${errors} violations of the exclusion zone.`); process.exit(1); }
console.log('\nAll black hole checks passed.');
