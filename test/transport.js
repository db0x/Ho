// Transporters: carry up to 5 satellites each from one own world to another.
// Loading and setting down happen at once; cargo does not fight and goes
// down with its transporter. The AI builds and uses them too.
import { createGame, addPlayer, startGame, resolveTurn, setOrders, buildView, fleetStats } from '../server/game.js';
import { shipStats, cargoOf, SHIP_DEFS } from '../shared/rules.js';
import { runBot } from '../server/bot.js';

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } };

/** Two empires; mine gets satellites and a transporter at home and a second world. */
function setup() {
  const g = createGame('Transport');
  g.settings.seed = 7;
  g.settings.turnTimer = 0;
  addPlayer(g, { name: 'Me' });
  addPlayer(g, { name: 'Enemy' });
  startGame(g);
  const [me, foe] = g.players;
  const home = g.galaxy.planets[me.homeworld];
  const byDistance = g.galaxy.planets.filter(p => p.owner === null)
    .sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y));
  const colony = Object.assign(byDistance[0], { owner: me.id, pop: 5 });
  const free = byDistance[1];
  me.money = 5000; me.metal = 2000;
  setOrders(g, me, { build: { planetId: home.id, type: 'satellite', count: 7 } });
  setOrders(g, me, { build: { planetId: home.id, type: 'transport', count: 1 } });
  resolveTurn(g);
  const fleet = g.fleets.find(f => f.owner === me.id && f.ships.some(s => s.type === 'transport'));
  // The transporter alone, without the starting ships
  const rest = fleet.ships.filter(s => s.type !== 'transport').map(s => s.id);
  if (rest.length) setOrders(g, me, { split: { fleetId: fleet.id, ships: rest } });
  const park = (f, p) => Object.assign(f, { at: p.id, x: p.x, y: p.y, z: p.z || 0, dest: null });
  return { g, me, foe, home, colony, free, fleet, park };
}

// 1) The type itself: range and speed of a tanker, no range bonus, room for 5
{
  const tr = shipStats('transport', {}), tk = shipStats('tanker', {});
  assert(tr.range === tk.range && tr.speed === tk.speed, 'Range and speed differ from the tanker');
  assert(tr.cargo === 5 && !tr.isTanker && tr.attack === 0, 'Transporter stats are off');
}

// 2) Loading at home, setting down at the colony - right away, damage stays
{
  const { g, me, home, colony, fleet, park } = setup();
  assert(home.defenses.length === 7, `Expected 7 satellites at home, found ${home.defenses.length}`);
  home.defenses[6].hp = 5;                       // the next one to be loaded is damaged
  const damaged = home.defenses[6].id;
  let r = setOrders(g, me, { load: { fleetId: fleet.id, count: 3 } });
  assert(!r, 'Loading 3 was refused: ' + r?.error);
  assert(home.defenses.length === 4 && cargoOf(fleet.ships).used === 3, 'Loading did not move 3 satellites aboard');
  const view = buildView(g, me);
  const vf = view.fleets.find(f => f.id === fleet.id);
  assert(cargoOf(vf.ships).used === 3, 'The view does not show the cargo');
  r = setOrders(g, me, { load: { fleetId: fleet.id } });
  assert(!r && cargoOf(fleet.ships).used === 5 && home.defenses.length === 2, 'Loading "all" does not stop at 5');
  r = setOrders(g, me, { load: { fleetId: fleet.id } });
  assert(r?.error === 'err.cargoFull', 'A full transporter accepts more: ' + r?.error);

  park(fleet, colony);
  r = setOrders(g, me, { drop: { fleetId: fleet.id, count: 2 } });
  assert(!r && (colony.defenses?.length || 0) === 2 && cargoOf(fleet.ships).used === 3, 'Setting down 2 failed');
  r = setOrders(g, me, { drop: { fleetId: fleet.id } });
  assert(!r && colony.defenses.length === 5 && cargoOf(fleet.ships).used === 0, 'Setting down the rest failed');
  const sat = colony.defenses.find(s => s.id === damaged);
  assert(sat && sat.hp === 5, 'The damage of a satellite got lost on the way');
  r = setOrders(g, me, { drop: { fleetId: fleet.id } });
  assert(r?.error === 'err.cargoEmpty', 'An empty transporter sets something down: ' + r?.error);
  console.log('Loading and setting down: at once, at most 5 per transporter, damage stays.');
}

// 3) Only above own worlds
{
  const { g, me, foe, home, free, fleet, park } = setup();
  setOrders(g, me, { load: { fleetId: fleet.id, count: 2 } });
  park(fleet, free);
  assert(setOrders(g, me, { drop: { fleetId: fleet.id } })?.error === 'err.cargoOwnWorld', 'Set down above a free world');
  park(fleet, g.galaxy.planets[foe.homeworld]);
  assert(setOrders(g, me, { drop: { fleetId: fleet.id } })?.error === 'err.cargoOwnWorld', 'Set down above an enemy world');
  park(fleet, home);
  const fighters = g.fleets.find(f => f.owner === me.id && f.id !== fleet.id && f.at === home.id);
  if (fighters) assert(setOrders(g, me, { load: { fleetId: fighters.id } })?.error === 'err.noTransporter', 'A fleet without transporter loads');
  console.log('Only above own worlds, only with a transporter.');
}

// 4) Range like a tanker but no bonus: two transporters reach as far as one
{
  const { g, me, home, fleet } = setup();
  setOrders(g, me, { build: { planetId: home.id, type: 'transport', count: 1 } });
  resolveTurn(g);
  const both = g.fleets.find(f => f.owner === me.id && f.ships.filter(s => s.type === 'transport').length === 2)
    || (setOrders(g, me, { merge: { planetId: home.id } }), g.fleets.find(f => f.owner === me.id && f.ships.filter(s => s.type === 'transport').length === 2));
  assert(both, 'No fleet with two transporters');
  if (both) {
    const one = Math.max(...both.ships.filter(s => s.type === 'transport').map(s => s.range));
    assert(fleetStats(both).range === Math.max(one, ...both.ships.map(s => s.range)), 'Transporters extend the range');
    assert(cargoOf(both.ships).capacity === 10, 'Two transporters do not hold 10');
  }
}

// 5) Cargo does not fight and goes down with the transporter
{
  const { g, me, foe, home, free, fleet, park } = setup();
  setOrders(g, me, { load: { fleetId: fleet.id, count: 4 } });
  park(fleet, free);
  const model = g.fleets.find(f => f.owner === foe.id).ships[0];
  const st = shipStats('fighter', model.tech);
  g.fleets.push({ id: 'f' + g.nextFleetId++, owner: foe.id, at: free.id, x: free.x, y: free.y, z: free.z || 0, dest: null,
    ships: Array.from({ length: 4 }, () => ({ ...model, id: 's' + g.nextShipId++, type: 'fighter',
      hp: st.maxHp, maxHp: st.maxHp, attack: st.attack, speed: Math.round(st.speed), range: Math.round(st.range), colonists: 0 })) });
  const entries = resolveTurn(g);
  const battle = entries.find(e => e.type === 'combat' && e.planetId === free.id && e.battle)?.battle;
  assert(battle, 'No battle at the free world');
  if (battle) {
    const mine = battle.sides.indexOf(me.id);
    assert(!battle.units.some(u => u[0] === mine && u[1] === 'satellite'), 'Satellites aboard took part in the battle');
  }
  assert(!g.fleets.some(f => f.id === fleet.id && f.ships.length), 'The transporter survived four fighters');
  const lost = entries.find(e => e.key === 'log.cargoLost' && e.private === me.id);
  assert(lost && lost.params.count === 4, 'The loss of the cargo is not reported');
  assert(!home.defenses.some(s => s.hp <= 0), 'Something is off at home');
  console.log('Cargo does not fight and is lost with the transporter.');
}

// 6) The AI builds transporters and moves satellites with them
{
  const g = createGame('Transport AI');
  g.settings.seed = 20251012;
  g.settings.turnTimer = 0;
  for (let i = 0; i < 12; i++) addPlayer(g, { isBot: true, name: 'AI ' + (i + 1), persona: i % 2 ? 'bulwark' : 'settler' });
  startGame(g);
  let built = 0, loads = 0, drops = 0;
  const aboard = new Map();          // transporter -> satellites aboard last turn
  for (let t = 0; t < 160 && g.state === 'running'; t++) {
    for (const b of g.players.filter(p => p.isBot && p.alive)) runBot(g, b);
    // What the bots did with the hold this turn - before combat can sink anything
    for (const f of g.fleets) for (const s of f.ships) {
      if (!s.cargo) continue;
      const before = aboard.get(s.id) ?? 0;
      if (s.cargo.length > before) loads++;
      if (s.cargo.length < before) drops++;
      aboard.set(s.id, s.cargo.length);
    }
    for (const e of resolveTurn(g)) if (e.key === 'log.built' && e.params.ship === 'transport') built += e.params.count;
    for (const f of g.fleets) for (const s of f.ships) {
      assert(!s.cargo || s.cargo.length <= SHIP_DEFS[s.type].cargo, 'A transporter carries more than 5');
      if (s.cargo) aboard.set(s.id, s.cargo.length);
    }
  }
  console.log(`AI: ${built} transporters built, ${loads}x loaded, ${drops}x set down.`);
  assert(built > 0, 'The AI never builds a transporter');
  assert(loads > 0 && drops > 0, 'The AI does not move satellites');
}

if (errors) { console.error(`\n${errors} transporter checks failed.`); process.exit(1); }
console.log('\nAll transporter checks passed.');
