// Destroyer: the capital ship. Costs as much as ten fighters on every tech
// level, needs Weapons 5, Shields 5 and a shipyard on a world with 20M
// people, fires eight guns, draws the fire, repairs its fleet in the orbit
// of an own world - and carries a name its owner can change.
import { createGame, addPlayer, startGame, resolveTurn, setOrders, buildView, devDestroyer } from '../server/game.js';
import { SHIP_NAMES } from '../server/shipnames.js';
import { shipCost, shipStats, buildLock, REPAIR_SHARE, refitCost, shipTypesFor } from '../shared/rules.js';
import { runBot } from '../server/bot.js';

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } };

/** Two empires; mine is rich and has a big homeworld. */
function setup() {
  const g = createGame('Destroyer');
  g.settings.seed = 5;
  g.settings.turnTimer = 0;
  addPlayer(g, { name: 'Me' });
  addPlayer(g, { name: 'Enemy' });
  startGame(g);
  const [me, foe] = g.players;
  const home = g.galaxy.planets[me.homeworld];
  me.money = 50000; me.metal = 20000;
  return { g, me, foe, home };
}
const unlock = p => { p.tech.weapons = 5; p.tech.shields = 5; };

// 1) Price: ten fighters on every level, also for refits
{
  for (const l of [1, 3, 5, 10, 20]) {
    const tech = { weapons: l, shields: l, speed: l, range: l, mini: Math.max(1, l - 2) };
    const d = shipCost('destroyer', tech), f = shipCost('fighter', tech);
    assert(d.money >= f.money * 9.5 && d.money <= f.money * 10.5, `Level ${l}: ${d.money} Cr is not about ten fighters (${f.money})`);
    assert(d.metal > f.metal * 10, `Level ${l}: a destroyer should need more metal than ten fighters`);
  }
  const old = { weapons: 5, shields: 5, speed: 5, range: 5 }, now = { weapons: 9, shields: 9, speed: 9, range: 9 };
  const rd = refitCost('destroyer', old, now), rf = refitCost('fighter', old, now);
  assert(rd.money >= rf.money * 9.5, 'A refit of a destroyer costs as little as a fighter\'s');
  const st = shipStats('destroyer', {});
  assert(st.guns === 8 && st.weight === 4 && st.repairs, 'Guns, weight or repair missing');
  assert(Math.abs(st.attack - 8 * shipStats('fighter', {}).attack) < 1e-9, 'Eight guns should hit as hard as eight fighters');
  console.log('Price: ten fighters on every level, refit included; 8 guns, weight 4.');
}

// 2) Locked: research and a large world first - when ordering and at the end of the turn
{
  const { g, me, home } = setup();
  assert(buildLock('destroyer', me.tech, home.pop)?.weapons === 5, 'Locked without research?');
  let r = setOrders(g, me, { build: { planetId: home.id, type: 'destroyer', count: 1 } });
  assert(r?.error === 'yard.locked', 'Order without research accepted');
  unlock(me);
  home.pop = 12;
  r = setOrders(g, me, { build: { planetId: home.id, type: 'destroyer', count: 1 } });
  assert(r?.error === 'yard.locked', 'Order on a small world accepted');
  // The population counts as shown, to one decimal: 19.96 reads 20.0 and is enough, 19.94 is not.
  assert(!buildLock('destroyer', me.tech, 19.96), 'A world showing 20.0M refused');
  assert(buildLock('destroyer', me.tech, 19.94)?.pop === 20, 'A world showing 19.9M accepted');
  home.pop = 30;
  r = setOrders(g, me, { build: { planetId: home.id, type: 'destroyer', count: 1 } });
  assert(!r?.error, 'Order refused although unlocked: ' + r?.error);
  // The world shrinks before the end of the turn: nothing is built, and it says so.
  home.pop = 15;
  const log = resolveTurn(g);
  assert(!g.fleets.some(f => f.ships.some(s => s.type === 'destroyer')), 'Built on a world that has become too small');
  assert(log.some(e => e.key === 'log.buildLocked'), 'No word about the build that did not happen');
  home.pop = 30;
  setOrders(g, me, { build: { planetId: home.id, type: 'destroyer', count: 2 } });
  resolveTurn(g);
  const built = g.fleets.flatMap(f => f.ships).filter(s => s.type === 'destroyer');
  assert(built.length === 2, `${built.length} destroyers built instead of 2`);
  console.log('Locked: refused without research and on small worlds, also at the end of the turn.');
}

// 3) Names: from the fund, never twice, numbered once it runs out - and the owner may rename
{
  const { g, me, foe, home } = setup();
  for (let i = 0; i < SHIP_NAMES.length + 3; i++) devDestroyer(g, me, home.id);
  const names = g.fleets.flatMap(f => f.ships).filter(s => s.type === 'destroyer').map(s => s.name);
  assert(names.length === SHIP_NAMES.length + 3, 'Dev mode did not place every destroyer');
  assert(new Set(names).size === names.length, 'A name was given twice');
  assert(names.slice(0, SHIP_NAMES.length).every(n => SHIP_NAMES.includes(n)), 'A name from outside the fund before it ran out');
  assert(names.slice(SHIP_NAMES.length).every(n => / II$/.test(n)), 'After the fund ran out, no numbered names: ' + names.slice(-3));
  const ship = g.fleets.flatMap(f => f.ships).find(s => s.type === 'destroyer');
  let r = setOrders(g, me, { rename: { shipId: ship.id, name: '  <b>O\'Brien</b>  ' } });
  assert(!r?.error && ship.name === 'bOʼBrien/b', 'Name not cleaned: ' + ship.name);
  r = setOrders(g, me, { rename: { shipId: ship.id, name: '   ' } });
  assert(r?.error === 'err.shipName' && ship.name === 'bOʼBrien/b', 'Empty name accepted');
  r = setOrders(g, foe, { rename: { shipId: ship.id, name: 'Stolen' } });
  assert(r?.error === 'err.noSuchShip' && ship.name !== 'Stolen', 'Renamed someone else\'s ship');
  const fighterFleet = g.fleets.find(f => f.owner === me.id && f.ships.includes(ship));
  setOrders(g, me, { build: { planetId: home.id, type: 'fighter', count: 1 } });
  resolveTurn(g);
  const fighter = g.fleets.flatMap(f => f.ships).find(s => s.type === 'fighter');
  assert(fighter && fighter.name === undefined, 'A fighter got a name');
  r = setOrders(g, me, { rename: { shipId: fighter.id, name: 'Viper' } });
  assert(r?.error === 'err.noSuchShip', 'A fighter could be named');
  // Others with a ship in the same orbit see the name - and not more
  g.fleets.push({ id: 'spy', owner: foe.id, ships: [{ id: 'spy1', type: 'scout', tech: {}, hp: 10, maxHp: 10, attack: 0, speed: 71, range: 323 }],
    at: home.id, x: home.x, y: home.y, z: home.z || 0, dest: null, hole: null });
  const seen = buildView(g, foe).fleets.find(f => f.id === fighterFleet.id);
  assert(seen?.ships.some(s => s.name) && seen.ships.every(s => s.hp === undefined), 'A foreign destroyer in sight shows no name, or too much');
  console.log(`Names: ${SHIP_NAMES.length} in the fund, never twice, then numbered; renaming cleaned and own ships only.`);
}

// 4) Combat: eight shots per round, and it draws the fire
{
  const { g, me, foe, home } = setup();
  unlock(me);
  devDestroyer(g, me, home.id);
  // 30 enemy fighters arrive above my homeworld
  const fleet = { id: 'fx', owner: foe.id, ships: [], at: home.id, x: home.x, y: home.y, z: home.z || 0, dest: null, hole: null };
  for (let i = 0; i < 30; i++) {
    const st = shipStats('fighter', foe.tech);
    fleet.ships.push({ id: 'x' + i, type: 'fighter', tech: { ...foe.tech }, hp: st.maxHp, maxHp: st.maxHp, attack: st.attack, speed: st.speed, range: st.range, colonists: 0 });
  }
  g.fleets.push(fleet);
  const log = resolveTurn(g);
  const battle = log.find(e => e.key === 'log.battle')?.battle;
  assert(battle, 'No battle');
  if (battle) {
    const d = battle.units.findIndex(u => u[1] === 'destroyer');
    assert(d >= 0, 'The destroyer is missing from the record');
    const first = battle.rounds[0];
    const shots = first.filter(([from]) => from === d).length;
    assert(shots === 8, `The destroyer fired ${shots} times in the first round instead of 8`);
    // Its share of the hits against my side: battery and destroyer, weight 1 and 4
    let atD = 0, atMine = 0;
    for (const round of battle.rounds) for (const [from, to] of round) {
      if (battle.units[from][0] === battle.units[d][0]) continue;
      atMine++;
      if (to === d) atD++;
    }
    assert(atMine > 0 && atD / atMine > 0.6, `The destroyer only drew ${Math.round(atD / atMine * 100)}% of the fire (expected about 80%)`);
  }
  console.log('Combat: eight shots per round, draws most of the fire next to the battery.');
}

// 5) Repairs: in the orbit of an own world, not in a turn with a battle, not without a destroyer
{
  const { g, me, home } = setup();
  setOrders(g, me, { build: { planetId: home.id, type: 'fighter', count: 2 } });
  resolveTurn(g);
  const fleet = g.fleets.find(f => f.owner === me.id && f.at === home.id);
  for (const s of fleet.ships) s.hp = 1;
  resolveTurn(g);
  assert(fleet.ships.every(s => s.hp === 1), 'Fighters repaired without a destroyer');
  devDestroyer(g, me, home.id);
  const d = fleet.ships.find(s => s.type === 'destroyer');
  d.hp = 10;
  const log = resolveTurn(g);
  const f = fleet.ships.find(s => s.type === 'fighter');
  assert(Math.abs(f.hp - Math.min(f.maxHp, 1 + f.maxHp * REPAIR_SHARE)) < 0.11, `Fighter at ${f.hp} instead of ${1 + f.maxHp * REPAIR_SHARE}`);
  assert(Math.abs(d.hp - (10 + d.maxHp * REPAIR_SHARE)) < 0.11, 'The destroyer did not repair itself');
  assert(log.some(e => e.key === 'log.repaired'), 'No word about the repair');
  for (let i = 0; i < 6; i++) resolveTurn(g);
  assert(fleet.ships.every(s => s.hp === s.maxHp), 'Repairs go beyond the hull or stop short');
  // Somewhere else - not an own world: no repairs
  const away = g.galaxy.planets.find(p => p.owner === null);
  fleet.at = away.id; fleet.x = away.x; fleet.y = away.y; fleet.z = away.z || 0;
  for (const s of fleet.ships) s.hp = 5;
  resolveTurn(g);
  assert(fleet.ships.every(s => s.hp === 5), 'Repaired in the orbit of a foreign world');
  console.log('Repairs: 20% per turn at own worlds with a destroyer, never beyond the hull, not elsewhere.');
}

// 6) Dev mode: on the chosen own world, otherwise the homeworld
{
  const { g, me, foe, home } = setup();
  const foreign = g.galaxy.planets[foe.homeworld];
  assert(devDestroyer(g, me, foreign.id), 'Dev destroyer refused');
  assert(g.fleets.some(f => f.owner === me.id && f.at === home.id && f.ships.some(s => s.type === 'destroyer')),
    'Not at the homeworld when a foreign world was chosen');
  me.alive = false;
  assert(!devDestroyer(g, me, home.id), 'A destroyer for an empire that is out');
  console.log('Dev mode: a destroyer at an own world, the homeworld as fallback.');
}

// 7) Classic Ho!!: with the lobby option off there are no destroyers at all
{
  const { g, me, home } = setup();
  g.settings.capitalShips = false;
  unlock(me);
  home.pop = 40;
  const r = setOrders(g, me, { build: { planetId: home.id, type: 'destroyer', count: 1 } });
  assert(r?.error === 'yard.noCapitals', 'Destroyer ordered in a classic game: ' + r?.error);
  assert(!setOrders(g, me, { build: { planetId: home.id, type: 'fighter', count: 1 } })?.error, 'Fighters refused in a classic game');
  assert(!devDestroyer(g, me, home.id), 'Dev mode placed a destroyer in a classic game');
  assert(buildView(g, me).capitalShips === false, 'The view does not tell the client');
  assert(!shipTypesFor(g.settings).includes('destroyer') && shipTypesFor({}).includes('destroyer'), 'shipTypesFor wrong');
  // AI empires, rich, researched and at war, still build none
  const bots = createGame('Classic');
  bots.settings.seed = 9; bots.settings.capitalShips = false;
  for (const persona of ['conqueror', 'bulwark']) addPlayer(bots, { name: persona, isBot: true, persona });
  startGame(bots);
  for (let t = 0; t < 40; t++) {
    for (const p of bots.players) { p.tech.weapons = Math.max(p.tech.weapons, 6); p.tech.shields = Math.max(p.tech.shields, 6); p.money += 3000; p.metal += 2000; runBot(bots, p); }
    resolveTurn(bots);
  }
  assert(!bots.fleets.some(f => f.ships.some(s => s.type === 'destroyer')), 'An AI built a destroyer in a classic game');
  // And with the option on, the same empires do
  const on = createGame('Capital');
  on.settings.seed = 9;
  for (const persona of ['conqueror', 'bulwark']) addPlayer(on, { name: persona, isBot: true, persona });
  startGame(on);
  for (let t = 0; t < 40; t++) {
    for (const p of on.players) { p.tech.weapons = Math.max(p.tech.weapons, 6); p.tech.shields = Math.max(p.tech.shields, 6); p.money += 3000; p.metal += 2000; runBot(on, p); }
    resolveTurn(on);
  }
  assert(on.fleets.some(f => f.ships.some(s => s.type === 'destroyer')), 'No AI built a destroyer although it could');
  console.log('Classic game: no destroyers - neither ordered, nor in dev mode, nor by the AI.');
}

if (errors) { console.error(`\n${errors} destroyer checks failed.`); process.exit(1); }
console.log('\nAll destroyer checks passed.');
