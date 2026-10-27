// Recycling: own ships and satellites are taken apart at an own shipyard -
// right away, for money, for metal. Only once researched; every level makes
// it cheaper and more thorough, but never past 80% metal and 5% cost.
import { createGame, addPlayer, startGame, resolveTurn, setOrders } from '../server/game.js';
import {
  recycleRates, recycleValue, shipCost, techMaxLevel, TECH_START_LEVEL,
  RECYCLE_MIN_LEVEL, RECYCLE_FULL_LEVEL, RECYCLE_MAX_METAL, RECYCLE_MIN_COST, SHIP_TYPES
} from '../shared/rules.js';

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } };

/** Two empires; mine has a fleet and satellites at home. */
function setup(level) {
  const g = createGame('Recycling');
  g.settings.seed = 11;
  g.settings.turnTimer = 0;
  addPlayer(g, { name: 'Me' });
  addPlayer(g, { name: 'Enemy' });
  startGame(g);
  const [me, foe] = g.players;
  const home = g.galaxy.planets[me.homeworld];
  me.money = 5000; me.metal = 2000;
  setOrders(g, me, { build: { planetId: home.id, type: 'satellite', count: 4 } });
  setOrders(g, me, { build: { planetId: home.id, type: 'fighter', count: 3 } });
  resolveTurn(g);
  me.tech.recycling = level;
  const fleet = g.fleets.find(f => f.owner === me.id && f.at === home.id);
  return { g, me, foe, home, fleet };
}

// 1) The curve: locked at the start, then better with every level, within the limits
{
  assert(TECH_START_LEVEL < RECYCLE_MIN_LEVEL && recycleRates(TECH_START_LEVEL) === null, 'Recycling works without research');
  let prev = null;
  for (let l = RECYCLE_MIN_LEVEL; l <= 40; l++) {
    const r = recycleRates(l);
    assert(r.metal <= RECYCLE_MAX_METAL + 1e-9 && r.cost >= RECYCLE_MIN_COST - 1e-9, `Level ${l} exceeds the limits`);
    if (prev && l <= RECYCLE_FULL_LEVEL) assert(r.metal > prev.metal && r.cost < prev.cost, `Level ${l} brings no improvement`);
    prev = r;
  }
  const top = recycleRates(RECYCLE_FULL_LEVEL);
  assert(Math.abs(top.metal - RECYCLE_MAX_METAL) < 1e-9 && Math.abs(top.cost - RECYCLE_MIN_COST) < 1e-9, 'The limits are never reached');
  assert(techMaxLevel('recycling') === RECYCLE_FULL_LEVEL, 'Recycling can be researched past its limits');
  // Rounded totals stay within the limits too
  for (const type of SHIP_TYPES) {
    for (const n of [1, 3, 17]) {
      const ships = Array.from({ length: n }, () => ({ type, tech: { mini: 1 } }));
      const c = shipCost(type, { mini: 1 });
      const v = recycleValue(ships, RECYCLE_FULL_LEVEL);
      assert(v.metal <= c.metal * n * RECYCLE_MAX_METAL + 1e-9, `${n}× ${type}: more than 80% of the metal`);
      assert(v.money >= c.money * n * RECYCLE_MIN_COST - 1e-9, `${n}× ${type}: cheaper than 5%`);
    }
  }
  console.log('Curve: locked at level 1, improves up to level ' + RECYCLE_FULL_LEVEL + ', 80% / 5% hold.');
}

// 2) Not researched: refused
{
  const { g, me, fleet } = setup(1);
  const r = setOrders(g, me, { recycle: { fleetId: fleet.id } });
  assert(r?.error === 'err.recycleLocked', 'Recycled without research: ' + r?.error);
  assert(g.fleets.includes(fleet), 'The fleet vanished anyway');
}

// 3) A fleet at home: gone right away, money down, metal up - exactly as computed
{
  const { g, me, fleet } = setup(8);
  const v = recycleValue(fleet.ships, 8);
  const money = me.money, metal = me.metal;
  const r = setOrders(g, me, { recycle: { fleetId: fleet.id } });
  assert(r?.recycled?.count === v.count, 'Recycling the fleet failed: ' + JSON.stringify(r));
  assert(!g.fleets.includes(fleet), 'The fleet is still there');
  assert(me.money === money - v.money && me.metal === metal + v.metal, 'Money or metal booked wrongly');
  assert(v.metal > 0 && v.money > 0, 'Recycling is free or yields nothing');
  console.log(`Fleet: ${v.count} ships for ${v.money} cr -> ${v.metal} metal.`);
}

// 4) Satellites: as many as asked for, the oldest first
{
  const { g, me, home } = setup(5);
  home.defenses[2].tech = { ...home.defenses[2].tech, weapons: 0 };     // the oldest one
  const oldest = home.defenses[2].id;
  const r = setOrders(g, me, { recycle: { planetId: home.id, count: 1 } });
  assert(r?.recycled?.count === 1 && home.defenses.length === 3, 'Recycling one satellite failed');
  assert(!home.defenses.some(s => s.id === oldest), 'Not the oldest satellite was recycled');
  setOrders(g, me, { recycle: { planetId: home.id } });
  assert(home.defenses.length === 0, 'Recycling all satellites left some behind');
  assert(setOrders(g, me, { recycle: { planetId: home.id } })?.error === 'err.recycleNothing', 'Recycled nothing without complaint');
}

// 5) Only at an own shipyard, only own ships
{
  const { g, me, foe, fleet } = setup(5);
  const away = g.galaxy.planets.find(p => p.owner === null);
  Object.assign(fleet, { at: away.id, x: away.x, y: away.y });
  assert(setOrders(g, me, { recycle: { fleetId: fleet.id } })?.error === 'err.recycleNoYard', 'Recycled above a free world');
  assert(setOrders(g, foe, { recycle: { fleetId: fleet.id } })?.error === 'err.noSuchFleet', 'Recycled a foreign fleet');
  assert(setOrders(g, me, { recycle: { planetId: foe.homeworld } })?.error === 'err.recycleNoYard', 'Recycled foreign satellites');
}

// 6) Orders placed before keep their money - otherwise recycling is refused
{
  const { g, me, home, fleet } = setup(3);
  const v = recycleValue(fleet.ships, 3);
  me.research.budgetPct = 0;
  me.money = shipCost('fighter', me.tech).money + v.money - 1;
  setOrders(g, me, { build: { planetId: home.id, type: 'fighter', count: 1 } });
  const r = setOrders(g, me, { recycle: { fleetId: fleet.id } });
  assert(r?.error === 'notice.recycleUnaffordable', 'Recycling took the money of a build order: ' + r?.error);
  assert(g.fleets.includes(fleet), 'The fleet vanished although refused');
}

// 7) The metal is there in the same turn - a build that lacked ore goes through
{
  const { g, me, home, fleet } = setup(RECYCLE_FULL_LEVEL);
  me.metal = 0;
  const v = recycleValue(fleet.ships, RECYCLE_FULL_LEVEL);
  setOrders(g, me, { recycle: { fleetId: fleet.id } });
  assert(me.metal === v.metal, 'Metal not credited');
  const r = setOrders(g, me, { build: { planetId: home.id, type: 'scout', count: 1 } });
  assert(!r, 'The recycled metal cannot be used right away: ' + r?.error);
}

if (errors) { console.error(`${errors} errors`); process.exit(1); }
console.log('Recycling: all checks passed.');
