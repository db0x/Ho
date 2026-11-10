// Orbital station: the shipyard for destroyers. Costs what a destroyer
// costs, needs Weapons 5, Shields 5 and a world with 20M people, one per
// world, is paid when ordered and ready three turns later. Fighters cost a
// quarter less there. It fights for its world - shot down, or the world
// lost, and it is gone - and it never flies or rides a transporter.
import { forecast } from '../shared/budget.js';
import { createGame, startGame } from '../server/game/game.js';
import { addShip, orbitFleet } from '../server/game/fleets.js';
import { buildView } from '../server/game/intel.js';
import { setOrders } from '../server/game/orders.js';
import { addPlayer } from '../server/game/players.js';
import { devStation } from '../server/game/shipyard.js';
import { resolveTurn } from '../server/game/turn.js';
import { runBot } from '../server/ai/bot.js';
import { survey, assessEnemies } from '../server/ai/situation.js';
import {
  shipCost, buildCost, buildLock, buildTypesFor, STATION, SHIP_TYPES, stationReady
} from '../shared/rules.js';

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } return ok; };

/** Two empires; mine is rich, researched and has a big homeworld. */
function setup(seed = 5) {
  const g = createGame('Station');
  g.settings.seed = seed;
  g.settings.turnTimer = 0;
  addPlayer(g, { name: 'Me' });
  addPlayer(g, { name: 'Enemy' });
  startGame(g);
  const [me, foe] = g.players;
  const home = g.galaxy.planets[me.homeworld];
  me.money = 50000; me.metal = 20000;
  me.research.budgetPct = 0;              // no research: prices stay put during the test
  home.pop = 30;
  return { g, me, foe, home };
}
const unlock = p => { p.tech.weapons = 5; p.tech.shields = 5; };
const order = (g, p, planet, type, count = 1) => setOrders(g, p, { build: { planetId: planet.id, type, count } });

// 1) The rules: price of a destroyer, not a ship, before the destroyer in the build list
{
  for (const l of [1, 5, 12]) {
    const tech = { weapons: l, shields: l, speed: l, range: l, mini: l };
    const s = shipCost('station', tech), d = shipCost('destroyer', tech);
    assert(s.money === d.money && s.metal === d.metal, `Level ${l}: station ${s.money}/${s.metal} is not the destroyer's ${d.money}/${d.metal}`);
  }
  assert(!SHIP_TYPES.includes('station'), 'The station is listed as a ship');
  const types = buildTypesFor({});
  assert(types.indexOf('station') === types.indexOf('destroyer') - 1, 'Station not right before the destroyer: ' + types);
  assert(!buildTypesFor({ capitalShips: false }).includes('station'), 'Station in a classic game');
  const tech = { weapons: 5, shields: 5 };
  const f = shipCost('fighter', tech), cheap = buildCost('fighter', tech, { station: { hp: 1 } });
  assert(cheap.money === Math.round(f.money * 0.75) && cheap.metal === Math.round(f.metal * 0.75), 'Fighter discount is not 25%');
  assert(buildCost('fighter', tech, { station: { hp: 1, building: 2 } }).money === f.money, 'A construction site gives a discount');
  assert(buildCost('scout', tech, { station: { hp: 1 } }).money === shipCost('scout', tech).money, 'Discount on something else than fighters');
  // The population counts as shown, to one decimal: 19.96 reads 20.0 and is enough, 19.94 is not.
  assert(!buildLock('station', tech, 19.96), 'A world showing 20.0M refused');
  assert(buildLock('station', tech, 19.94)?.pop === 20, 'A world showing 19.9M accepted');
  console.log('Rules: priced like a destroyer, listed before it, fighters 25% cheaper at a ready one.');
}

// 2) Ordering: research, population, one per world
{
  const { g, me, home } = setup();
  assert(order(g, me, home, 'station')?.error === 'yard.locked', 'Station ordered without research');
  unlock(me);
  home.pop = 12;
  assert(order(g, me, home, 'station')?.error === 'yard.locked', 'Station ordered on a small world');
  home.pop = 30;
  assert(!order(g, me, home, 'station')?.error, 'Station refused although unlocked');
  assert(order(g, me, home, 'station')?.error === 'yard.stationExists', 'A second station ordered in the same turn');
  assert(me.orders.builds[home.id].station === 1, 'More than one station on order');
  const cost = shipCost('station', me.tech);
  const log = resolveTurn(g);
  assert(home.station && home.station.building === STATION.buildTurns, 'No construction site after the turn');
  assert(me.ledger.build.money === cost.money && me.ledger.build.metal === cost.metal, 'Not paid in full when ordered');
  assert(log.some(e => e.key === 'log.stationStarted'), 'No word that the construction began');
  assert(order(g, me, home, 'station')?.error === 'yard.stationExists', 'A second station on a world with a site');
  console.log('Ordering: research and 20M people first, one per world, paid at the end of the turn.');
}

// 3) Three turns of construction; the destroyer only at a ready station
{
  const { g, me, home } = setup();
  unlock(me);
  order(g, me, home, 'station');
  resolveTurn(g);
  let readyAt = null;
  for (let i = 1; i <= 5 && readyAt == null; i++) {
    assert(order(g, me, home, 'destroyer')?.error === 'yard.lockedStation', `Destroyer ordered at a construction site (turn ${i})`);
    const log = resolveTurn(g);
    if (log.some(e => e.key === 'log.stationReady')) readyAt = i;
  }
  assert(readyAt === STATION.buildTurns, `Ready after ${readyAt} more turns instead of ${STATION.buildTurns}`);
  assert(stationReady(home.station), 'Station not ready');
  const v = buildView(g, me).planets[home.id];
  assert(v.station && v.station.building === 0 && v.station.attack > 0, 'The view does not show the ready station');
  assert(!order(g, me, home, 'destroyer')?.error, 'Destroyer refused at a ready station');
  resolveTurn(g);
  assert(g.fleets.some(f => f.owner === me.id && f.ships.some(s => s.type === 'destroyer')), 'No destroyer built at the station');
  console.log(`Construction: ready ${STATION.buildTurns} turns after the order, then destroyers can be built.`);
}

// 4) Fighters: a quarter cheaper at the station - and the forecast knows it
{
  const { g, me, home } = setup();
  unlock(me);
  devStation(g, me, home.id);
  order(g, me, home, 'fighter', 4);
  const view = buildView(g, me);
  const f = forecast(view);
  const expect = buildCost('fighter', me.tech, home);
  assert(Math.abs(f.build.booked.money - expect.money * 4) < 1e-6, `Forecast ${f.build.booked.money} instead of ${expect.money * 4}`);
  resolveTurn(g);
  assert(Math.abs(me.ledger.build.money - expect.money * 4) < 1e-6, `Booked ${me.ledger.build.money} instead of ${expect.money * 4}`);
  assert(expect.money < shipCost('fighter', me.tech).money, 'Fighters not cheaper at the station');
  console.log('Fighters: 25% cheaper at the station, forecast and booking agree.');
}

// 5) Battle: it fights for its world, holds the orbit while it stands, and can be shot down
{
  const { g, me, foe, home } = setup();
  unlock(me); unlock(foe);
  devStation(g, me, home.id);
  home.defenses = [];
  home.pop = 1;                            // a weak battery - the station carries the defense
  const raid = orbitFleet(g, foe.id, home);
  for (let i = 0; i < 3; i++) addShip(g, raid, 'scout', foe.tech);
  const log = resolveTurn(g);
  const battle = log.find(e => e.key === 'log.battle' && e.planetId === home.id)?.battle;
  assert(battle && battle.units.some(u => u[1] === 'station'), 'The station is not in the battle');
  assert(battle && battle.rounds.flat().some(([from]) => battle.units[from][1] === 'station'), 'The station never fired');
  assert(home.owner === me.id && home.station, 'Lost to three scouts');

  // A real fleet: the station holds the world as long as it stands, then it goes.
  const big = orbitFleet(g, foe.id, home);
  for (let i = 0; i < 40; i++) addShip(g, big, 'fighter', { ...foe.tech, weapons: 12, shields: 12 });
  let gone = null, owner = null;
  for (let t = 0; t < 8 && home.owner === me.id; t++) {
    const l = resolveTurn(g);
    if (l.some(e => e.key === 'log.stationLost')) gone = t;
    if (home.owner !== me.id) owner = t;
    if (home.station && home.owner !== me.id) assert(false, 'The world fell while its station still stood');
  }
  assert(gone != null, 'The station was never shot down');
  assert(home.station == null, 'The station survives at a lost world');
  assert(home.owner === foe.id, 'The world was not taken after the station fell');
  console.log(`Battle: fights along, holds the orbit; shot down after ${gone + 1} turn(s), the world fell after ${owner + 1}.`);
}

// 6) A construction site does not fire, does not hold the orbit and is lost with the world
{
  const { g, me, foe, home } = setup();
  unlock(me);
  order(g, me, home, 'station');
  resolveTurn(g);
  home.defenses = [];
  home.pop = 0.6;
  const big = orbitFleet(g, foe.id, home);
  for (let i = 0; i < 30; i++) addShip(g, big, 'fighter', { ...foe.tech, weapons: 10, shields: 10 });
  const log = resolveTurn(g);
  const battle = log.find(e => e.key === 'log.battle' && e.planetId === home.id)?.battle;
  const site = battle?.units.findIndex(u => u[1] === 'stationSite');
  assert(site >= 0, 'The construction site is not in the battle');
  assert(!battle.rounds.flat().some(([from]) => from === site), 'The construction site fired');
  assert(home.owner === foe.id || !home.station, 'The site neither fell nor was shot down');
  if (home.owner === foe.id) assert(!home.station, 'The conqueror got the construction site');
  console.log('Construction site: a target only, gone with the world.');
}

// 7) Never on a transporter, never with the satellites
{
  const { g, me, home } = setup();
  unlock(me);
  devStation(g, me, home.id);
  home.defenses = [];
  const fleet = orbitFleet(g, me.id, home);
  addShip(g, fleet, 'transport', me.tech);
  const r = setOrders(g, me, { load: { fleetId: fleet.id } });
  assert(r?.error === 'err.noSatellites', 'Something was loaded although there are no satellites: ' + JSON.stringify(r));
  assert(home.station && fleet.ships.every(s => !s.cargo?.length), 'The station went aboard');
  assert(setOrders(g, me, { recycle: { planetId: home.id } })?.error, 'Recycling took the station apart');
  assert(home.station, 'The station is gone after recycling satellites');
  console.log('Transport: the station stays where it was built.');
}

// 8) Classic Ho!!: no station
{
  const { g, me, home } = setup();
  g.settings.capitalShips = false;
  unlock(me);
  assert(order(g, me, home, 'station')?.error === 'yard.noCapitals', 'Station ordered in a classic game');
  assert(!devStation(g, me, home.id), 'Dev mode placed a station in a classic game');
  // The shipyard in the client lists what the view allows - no station.
  assert(!buildTypesFor(buildView(g, me)).includes('station'), 'The shipyard offers a station in a classic game');
  // AI empires, rich, researched and at war, build none either.
  const bots = createGame('Classic');
  bots.settings.seed = 9; bots.settings.capitalShips = false;
  for (const persona of ['conqueror', 'bulwark']) addPlayer(bots, { name: persona, isBot: true, persona });
  startGame(bots);
  for (let t = 0; t < 40; t++) {
    for (const p of bots.players) { p.tech.weapons = Math.max(p.tech.weapons, 6); p.tech.shields = Math.max(p.tech.shields, 6); p.money += 3000; p.metal += 2000; runBot(bots, p); }
    resolveTurn(bots);
  }
  assert(!bots.galaxy.planets.some(p => p.station), 'An AI built a station in a classic game');
  console.log('Classic game: no station - neither ordered, offered, in dev mode, nor by the AI.');
}

// 9) The AI: builds a station first, then destroyers at it - the setting of test/destroyer.js
{
  const g = createGame('Bots');
  g.settings.seed = 9;
  for (const persona of ['conqueror', 'bulwark']) addPlayer(g, { name: persona, isBot: true, persona });
  startGame(g);
  let firstStation = null, firstDestroyer = null;
  for (let t = 0; t < 40; t++) {
    for (const p of g.players) { p.tech.weapons = Math.max(p.tech.weapons, 6); p.tech.shields = Math.max(p.tech.shields, 6); p.money += 3000; p.metal += 2000; runBot(g, p); }
    resolveTurn(g);
    if (firstStation == null && g.galaxy.planets.some(p => p.station)) firstStation = t;
    if (firstDestroyer == null && g.fleets.some(f => f.ships.some(s => s.type === 'destroyer'))) firstDestroyer = t;
  }
  assert(firstStation != null, 'The AI never built a station');
  assert(firstDestroyer != null, 'The AI never built a destroyer at its station');
  assert(firstDestroyer == null || firstStation == null || firstDestroyer > firstStation + STATION.buildTurns - 1,
    `A destroyer (turn ${firstDestroyer}) before the station could be ready (turn ${firstStation})`);
  console.log(`AI: first station in turn ${firstStation}, first destroyer in turn ${firstDestroyer}.`);
}

// 10) The AI reckons with stations: an enemy world with one costs its hull
// more to take - and its own fighters are built at a station when one is near.
{
  const g = createGame('Reckon');
  g.settings.seed = 9;
  // The world is made known below by hand, without ever being seen - that
  // only works without fog of war (test/fog.js covers that).
  g.settings.fog = false;
  for (const persona of ['conqueror', 'bulwark']) addPlayer(g, { name: persona, isBot: true, persona });
  startGame(g);
  const [bot, foe] = g.players;
  for (const p of g.players) { p.money = 20000; p.metal = 8000; unlock(p); }
  const target = g.galaxy.planets[foe.homeworld];
  // The AI only goes for worlds it has seen.
  bot.explored.add(target.id);
  const priceOf = () => {
    const s = survey(g, bot);
    s.treasury = bot.money;
    assessEnemies(s);
    return s.enemyWorlds.some(p => p.id === target.id) ? s.price(target) : null;
  };
  const before = priceOf();
  devStation(g, foe, target.id);
  const after = priceOf();
  if (assert(before != null, 'The enemy homeworld is not among the AI\'s targets')) {
    assert(Math.abs(after - before - target.station.hp) < 1e-6, `Station not counted: ${before} -> ${after} (hull ${target.station.hp})`);
  }

  // Fighters at the station: give the bot a ready one at its homeworld and let it arm.
  const home = g.galaxy.planets[bot.homeworld];
  home.pop = Math.max(home.pop, 30);
  devStation(g, bot, home.id);
  let atStation = 0, elsewhere = 0;
  for (let t = 0; t < 12; t++) {
    bot.money += 3000; bot.metal += 2000;
    runBot(g, bot);
    for (const [pid, q] of Object.entries(bot.orders.builds)) {
      if (!q.fighter) continue;
      if (g.galaxy.planets[pid].station) atStation += q.fighter; else elsewhere += q.fighter;
    }
    resolveTurn(g);
    if (!home.station || home.owner !== bot.id) break;
  }
  assert(atStation > 0, `The AI never built fighters at its station (${elsewhere} elsewhere)`);
  console.log(`AI: an enemy station adds its hull to the price (${Math.round(before)} -> ${Math.round(after)}); fighters ordered at the station ${atStation}, elsewhere ${elsewhere}.`);
}

if (errors) { console.log(`\n${errors} station checks failed.`); process.exit(1); }
console.log('\nAll station checks passed.');
