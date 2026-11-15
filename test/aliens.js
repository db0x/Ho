// Aliens: rare raids out of a rift. They come within sight and with the
// technology of the empire they visit, every empire gets its turn, they
// leave a world they overrun empty instead of taking it, never take an
// empire's last world, break off without their carrier - and can be beaten.
import { createGame, startGame } from '../server/game/game.js';
import { buildView, inSight } from '../server/game/intel.js';
import { addPlayer } from '../server/game/players.js';
import { resolveTurn } from '../server/game/turn.js';
import { newFleet, addShip } from '../server/game/fleets.js';
import { spawnAliens, alienTurn, alienFleets, devAliens } from '../server/aliens.js';
import { ALIENS, ALIEN_ID, ALIEN_SPOILS, alienRules, dist, wreckMetal, salvageRate, alienInsight, techCostToNext } from '../shared/rules.js';
import { wrecksOf, wreckAt } from '../server/spoils.js';
import { forecast } from '../shared/budget.js';
import { offerAlliance, answerOffer } from '../server/game/diplomacy.js';
import { sanitizeSettings } from '../server/hub/lobby.js';
import { runBot } from '../server/ai/bot.js';
import { setOrders } from '../server/game/orders.js';

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } };

/** Three empires, each with its homeworld and three colonies nearby - on the easy level unless told otherwise. */
function setup(seed = 11, level = 1) {
  const g = createGame('Aliens');
  g.settings.seed = seed;
  g.settings.turnTimer = 0;
  g.settings.alienLevel = level;
  for (const name of ['Ann', 'Bob', 'Cid']) addPlayer(g, { name });
  startGame(g);
  for (const p of g.players) {
    const home = g.galaxy.planets[p.homeworld];
    const free = g.galaxy.planets.filter(q => !q.owner).sort((a, b) => dist(a, home) - dist(b, home));
    for (const q of free.slice(0, 3)) { q.owner = p.id; q.pop = 8; }
    p.tech.weapons = 4; p.tech.shields = 3; p.tech.speed = 2;
  }
  g.fleets = [];          // no starting ships in the way
  g.turn = ALIENS.firstTurn;
  return g;
}
const colonies = (g, p) => g.galaxy.planets.filter(q => q.owner === p.id && q.id !== p.homeworld);

/** A swarm in the orbit of a world, as if it had just arrived. */
function swarmAt(g, world, fighters, tech) {
  const f = newFleet(g, ALIEN_ID, world);
  addShip(g, f, 'alienCarrier', tech);
  for (let i = 0; i < fighters; i++) addShip(g, f, 'alienFighter', tech);
  f.alien = { target: world.owner, tech, full: fighters, raids: 0, born: g.turn,
    hp0: f.ships.reduce((a, s) => a + s.maxHp, 0) };
  return f;
}

// 1) Arrival: a carrier and its fighters, in sight, with the victim's technology
{
  const g = setup();
  const entries = [];
  const f = spawnAliens(g, entries);
  assert(f && f.owner === ALIEN_ID, 'No swarm came out of the rift');
  const victim = g.players.find(p => p.id === f.alien.target);
  const types = f.ships.map(s => s.type);
  assert(types.filter(t => t === 'alienCarrier').length === 1, 'Not exactly one carrier');
  assert(types.filter(t => t === 'alienFighter').length === ALIENS.fighters(g.turn), 'Wrong number of fighters');
  assert(f.ships.every(s => s.tech.weapons === victim.tech.weapons && s.tech.shields === victim.tech.shields),
    'The aliens do not carry the technology of the empire they visit');
  const world = g.galaxy.planets[f.dest];
  assert(world.owner === victim.id && world.id !== victim.homeworld, 'The first target is not a colony of the victim');
  const d = dist(f, world);
  assert(d >= ALIENS.distance[0] * 0.7 && d <= ALIENS.distance[1] * 1.1, `The rift opened ${Math.round(d)} ly away`);
  assert(inSight(g, victim.id, f), 'The victim does not see the swarm coming');
  assert(entries.some(e => e.key === 'log.alienRift' && e.playerIds.includes(victim.id)), 'No warning in the log');
  assert(g.alienRifts.length === 1 && g.alienRifts[0].kind === 'open', 'No rift for the map');
  const view = buildView(g, victim);
  assert(view.fleets.some(x => x.owner === ALIEN_ID && x.dest === world.id && x.eta >= 1), 'The view does not show course and arrival');
  assert(view.rifts.length === 1, 'The victim does not see the rift');
  console.log(`Arrival: carrier + ${types.length - 1} fighters, ${Math.round(d)} ly from ${world.name}, in sight.`);
}

// 2) Every empire gets its turn: the least visited one is next
{
  const g = setup();
  for (let i = 0; i < 9; i++) { spawnAliens(g, []); g.fleets = []; }
  const visits = g.players.map(p => g.aliens.visits[p.id] || 0);
  assert(visits.every(v => v === 3), `Raids unevenly spread: ${visits.join('/')}`);
  // Empires with fewer than three worlds are left alone.
  const small = g.players[0];
  for (const q of colonies(g, small).slice(1)) { q.owner = null; q.pop = 0; }
  for (let i = 0; i < 6; i++) {
    const f = spawnAliens(g, []);
    assert(!f || f.alien.target !== small.id, 'A small empire was visited');
    g.fleets = [];
  }
  console.log(`Fair: ${visits.join('/')} raids each, small empires spared.`);
}

// 3) Overrun: an undefended colony is left empty and free
{
  const g = setup();
  const [ann] = g.players;
  const world = colonies(g, ann)[0];
  world.pop = 3;
  swarmAt(g, world, 4, { ...ann.tech });
  const entries = resolveTurn(g);
  assert(world.owner === null && world.pop === 0, `The colony was not emptied (owner ${world.owner}, ${world.pop}M)`);
  assert(entries.some(e => e.key === 'log.alienOverrun' && e.playerIds.includes(ann.id)), 'The owner was not told');
  assert(!g.galaxy.planets.some(q => q.owner === ALIEN_ID), 'The aliens own a world');
  console.log(`Overrun: ${world.name} is empty and free again.`);
}

// 4) A defended world holds: satellites and the battery beat the swarm
{
  const g = setup();
  const [ann] = g.players;
  const world = colonies(g, ann)[0];
  world.pop = 16;
  world.defenses = [];
  const yard = newFleet(g, ann.id, world);
  for (let i = 0; i < 5; i++) addShip(g, yard, 'satellite', ann.tech);
  world.defenses = yard.ships; yard.ships = [];
  g.fleets = g.fleets.filter(f => f !== yard);
  swarmAt(g, world, ALIENS.fighters(60), { ...ann.tech });
  for (let i = 0; i < 4 && alienFleets(g).length; i++) resolveTurn(g);
  assert(world.owner === ann.id, 'A world with 16M and five satellites fell to the aliens');
  assert(!alienFleets(g).some(f => f.at === world.id), 'The swarm still sits in the orbit');
  console.log(`Defended: ${world.name} with five satellites holds.`);
}

// 5) A fleet of the same strength wins - they can be beaten
{
  let wins = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const g = setup(seed);
    const [ann] = g.players;
    const world = colonies(g, ann)[0];
    world.pop = 1;               // hardly any battery: it is up to the fleet
    const n = ALIENS.fighters(60);
    const fleet = newFleet(g, ann.id, world);
    for (let i = 0; i < n + 4; i++) addShip(g, fleet, 'fighter', ann.tech);
    swarmAt(g, world, n, { ...ann.tech });
    resolveTurn(g);
    if (world.owner === ann.id) wins++;
  }
  assert(wins >= 7, `A fleet of a few more fighters than the swarm has ships won only ${wins} of 10`);
  console.log(`Beatable: an equal fleet held the world ${wins} times out of 10.`);
}

// 6) The last world of an empire is spared
{
  const g = setup();
  const [ann] = g.players;
  for (const q of colonies(g, ann)) { q.owner = null; q.pop = 0; }
  const home = g.galaxy.planets[ann.homeworld];
  home.pop = 2;
  swarmAt(g, home, 6, { ...ann.tech });
  resolveTurn(g);
  assert(home.owner === ann.id && ann.alive, 'The aliens took the last world of an empire');
  console.log('Last world: spared.');
}

// 7) Without their carrier the fighters break off; with it they are replenished
{
  const g = setup();
  g.settings.aliens = false;
  const [ann] = g.players;
  const world = colonies(g, ann)[0];
  const f = swarmAt(g, world, 3, { ...ann.tech });
  f.at = null; f.x += 400;                            // somewhere in space
  f.ships = f.ships.filter(s => s.type === 'alienFighter');
  const entries = [];
  alienTurn(g, entries);
  assert(!alienFleets(g).length, 'Fighters without a carrier stayed');
  assert(entries.some(e => e.key === 'log.alienBrokeOff'), 'No word of the fighters fleeing');

  const h = swarmAt(g, world, 3, { ...ann.tech });
  h.at = null; h.x += 400;
  h.ships = h.ships.slice(0, 2);                      // carrier and one fighter left
  alienTurn(g, [], new Set());
  assert(h.ships.length === 3, `The carrier sent out no new fighter (${h.ships.length} ships)`);
  alienTurn(g, [], new Set([world.id]));
  h.at = world.id;
  alienTurn(g, [], new Set([world.id]));
  assert(h.ships.length === 4, 'The carrier sent out fighters in the middle of a battle');
  alienTurn(g, [], new Set());
  assert(h.ships.length === 4, 'The carrier sent out more fighters than it brought');
  // After their time they leave on their own
  g.turn = h.alien.born + ALIENS.life;
  alienTurn(g, []);
  assert(!alienFleets(g).length, 'The aliens overstayed their time');
  console.log('Carrier: without it the swarm flees; with it lost fighters return.');
}

// 8) Rare, and switched off in the lobby means never
{
  const count = (on, level = 1) => {
    const g = setup(21, level);
    g.settings.aliens = on;
    g.turn = 1;
    let raids = 0;
    for (; g.turn < 200; g.turn++) {
      const e = [];
      alienTurn(g, e);
      raids += e.filter(x => x.key === 'log.alienRift').length;
      g.fleets = [];
    }
    return raids;
  };
  const off = count(false), on = count(true);
  assert(off === 0, `Aliens came although switched off (${off})`);
  const expect = (200 - ALIENS.firstTurn) / ALIENS.interval(3);
  assert(on >= expect * 0.6 && on <= expect * 1.5, `${on} raids in 200 turns, about ${expect.toFixed(1)} expected`);
  console.log(`Rare: ${on} raids in 200 turns with three empires; none when switched off.`);
}

// 9) Strength levels: the stronger, the more often, the bigger, the better armed
{
  const count = (level) => {
    const g = setup(21, level);
    g.turn = 1;
    let raids = 0;
    for (; g.turn < 200; g.turn++) {
      const e = [];
      alienTurn(g, e);
      raids += e.filter(x => x.key === 'log.alienRift').length;
      g.fleets = [];
    }
    return raids;
  };
  const raids = [1, 2, 3].map(count);
  assert(raids[0] < raids[1] && raids[1] < raids[2], `Raids do not grow with the level: ${raids.join('/')}`);
  const swarm = (level) => {
    const g = setup(11, level);
    g.turn = 120;
    const f = spawnAliens(g, []);
    const victim = g.players.find(p => p.id === f.alien.target);
    return { f, victim, fighters: f.ships.filter(s => s.type === 'alienFighter').length,
      carriers: f.ships.filter(s => s.type === 'alienCarrier').length };
  };
  const [easy, mid, hard] = [1, 2, 3].map(swarm);
  assert(easy.fighters < mid.fighters && mid.fighters < hard.fighters,
    `Swarms do not grow with the level: ${easy.fighters}/${mid.fighters}/${hard.fighters}`);
  assert(easy.carriers === 1 && mid.carriers === 1 && hard.carriers === 2, 'Wrong number of carriers per level');
  for (const [lv, sw] of [[1, easy], [2, mid], [3, hard]]) {
    const bonus = alienRules(lv).techBonus;
    assert(sw.f.ships.every(s => s.tech.weapons === sw.victim.tech.weapons + bonus),
      `Level ${lv}: the aliens are not ${bonus} weapon levels ahead`);
  }
  // Without the setting (older games) it is the medium level; the lobby keeps it in range.
  assert(alienRules({ settings: {} }).techBonus === alienRules(2).techBonus, 'No default level');
  assert(sanitizeSettings({ alienLevel: 7 }).alienLevel === 3 && sanitizeSettings({ alienLevel: 0 }).alienLevel === 1,
    'The lobby lets an alien level out of range through');
  console.log(`Levels: ${raids.join('/')} raids in 200 turns, ${easy.fighters}/${mid.fighters}/${hard.fighters} fighters at turn 120.`);
}

// 10) Dev mode: aliens at the selected world right away
{
  const g = setup();
  const [, bob] = g.players;
  const world = colonies(g, bob)[1];
  const entries = [];
  assert(devAliens(g, g.players[0], world.id, entries), 'Dev mode could not summon aliens');
  const f = alienFleets(g)[0];
  assert(f && f.dest === world.id && f.alien.target === bob.id, 'The aliens do not head for the selected world');
  assert(entries.length > 0, 'Nobody read about the rift');
  console.log(`Dev mode: aliens heading for ${world.name}.`);
}

// 11) A whole game with AI empires and aliens: the AI copes, nothing breaks
{
  const g = createGame('AI');
  g.settings.seed = 77;
  for (let i = 0; i < 6; i++) addPlayer(g, { isBot: true, level: i % 2 ? 'hard' : 'normal' });
  startGame(g);
  let raids = 0, overruns = 0, kills = 0, wrecks = 0, salvaged = 0;
  for (let t = 0; t < 160 && g.state === 'running'; t++) {
    for (const b of g.players.filter(p => p.alive)) runBot(g, b);
    for (const e of resolveTurn(g)) {
      if (e.key === 'log.alienRift') raids++;
      if (e.key === 'log.alienOverrun') overruns++;
      if (e.key === 'log.alienKill' || e.key === 'log.alienKillPlain') kills++;
      if (e.key === 'log.wreck') wrecks++;
      if (e.key === 'log.salvaged' || e.key === 'log.salvagedAll') salvaged += e.params.metal;
    }
    for (const p of g.players) buildView(g, p);
    assert(!g.galaxy.planets.some(q => q.owner === ALIEN_ID), 'Aliens own a world');
    assert(alienFleets(g).every(f => f.ships.some(s => s.type === 'alienCarrier')), 'A swarm without a carrier stayed');
  }
  assert(raids >= 4, `Only ${raids} raids in 160 turns with six empires`);
  const visited = Object.keys(g.aliens.visits).length;
  // Wrecks in orbit are worth a trip: the AI salvages them.
  if (wrecks) assert(salvaged > 0, `${wrecks} wrecks, but the AI salvaged nothing`);
  console.log(`AI game: ${raids} raids, ${overruns} worlds overrun, ${visited} of 6 empires visited, `
    + `${kills} carriers shot down, ${wrecks} wrecks, ${salvaged} metal salvaged.`);
}

// 12) The spoils: whoever did the most damage to the carrier learns from it,
// its best destroyer gets a trophy, and the wreck stays in orbit to salvage
{
  const g = setup(11, 2);
  g.settings.aliens = false;           // only the swarm placed here
  const ann = g.players[0];
  const world = colonies(g, ann)[0];
  ann.tech.weapons = 5; ann.tech.shields = 5;
  ann.research.budgetPct = 0;          // no research of its own in the way
  const tech = { weapons: 6, shields: 6, speed: 2 };
  swarmAt(g, world, 2, tech);
  const fleet = newFleet(g, ann.id, world);
  addShip(g, fleet, 'destroyer', ann.tech);
  addShip(g, fleet, 'destroyer', ann.tech);
  for (let i = 0; i < 6; i++) addShip(g, fleet, 'fighter', ann.tech);
  const rp = { weapons: ann.researchPoints.weapons, shields: ann.researchPoints.shields };
  const entries = resolveTurn(g);
  assert(!alienFleets(g).length, 'The swarm survived a fleet twice its strength');
  const kill = entries.find(e => e.key === 'log.alienKill');
  assert(kill && kill.private === ann.id, 'No credit for the carrier shot down');
  const share = alienInsight(6, 5);
  assert(kill?.params.weapons === Math.round(share * 100), `Insight ${kill?.params.weapons} % instead of ${Math.round(share * 100)} %`);
  const gained = ann.researchPoints.weapons - rp.weapons;
  assert(Math.abs(gained - share * techCostToNext(5)) < 1e-6 || ann.tech.weapons > 5, `Research points ${gained} instead of ${share * techCostToNext(5)}`);
  const aces = fleet.ships.filter(s => s.trophies);
  assert(aces.length === 1 && aces[0].type === 'destroyer' && aces[0].trophies === 1, 'Not exactly one destroyer with a trophy');
  assert(entries.some(e => e.key === 'log.alienTrophy' && e.params.vessel === aces[0]?.name), 'The trophy is not in the log');
  const w = wreckAt(g, world.id);
  assert(w && w.metal === wreckMetal(tech) && w.total === w.metal, 'No wreck with the metal of the carrier in orbit');
  const view = JSON.parse(JSON.stringify(buildView(g, ann)));
  assert(view.planets[world.id].wreck?.metal === w.metal, 'The wreck is not in the view');
  assert(view.fleets.find(f => f.id === fleet.id).ships.some(s => s.trophies === 1), 'The trophy is not in the view');
  // The empire's trophy: everyone sees it in the ranking - with fog of war too.
  g.settings.fog = true;
  const other = buildView(g, g.players[1]);
  assert(other.players.find(p => p.id === ann.id)?.carriers === 1, 'Others do not see the carrier shot down');
  assert(other.players.find(p => p.id === ann.id)?.stats === null, 'Fog: the tallies should stay hidden');
  assert(!('carriers' in other.players.find(p => p.id === g.players[1].id)), 'An empire without kills shows a trophy');
  g.settings.fog = false;
  // The forecast knows the salvage of the next turn - and the turn books it.
  const f = forecast(view);
  const rate = salvageRate(w.total, false);
  assert(f.salvage === Math.min(w.metal, rate), `Forecast salvage ${f.salvage} instead of ${rate}`);
  const metal = ann.metal;
  resolveTurn(g);
  assert(ann.ledger.salvage === Math.min(w.total, rate), `Salvaged ${ann.ledger.salvage} instead of ${rate}`);
  assert(ann.metal >= metal + ann.ledger.salvage, 'The salvage did not reach the treasury');
  // Salvaged to the end in ALIEN_SPOILS.haul turns, then the wreck is gone.
  for (let t = 1; t < ALIEN_SPOILS.haul; t++) resolveTurn(g);
  assert(!wreckAt(g, world.id), 'The wreck is still there after salvaging it all');
  console.log(`Spoils: insight ${kill?.params.weapons} %, trophy for the ${aces[0]?.name}, wreck of ${w.total} metal salvaged in ${ALIEN_SPOILS.haul} turns.`);
}

// 13) The wreck: a transporter salvages twice as fast, allies share, a
// hostile world keeps others away, and an untouched wreck breaks up
{
  const g = setup();
  g.settings.aliens = false;
  const [ann, bob, cid] = g.players;
  const world = colonies(g, ann)[0];
  const put = (owner, types) => {
    const f = newFleet(g, owner.id, world);
    for (const t of types) addShip(g, f, t, owner.tech);
    return f;
  };
  wrecksOf(g).push({ planetId: world.id, metal: 90, total: 90, born: g.turn - 1, until: g.turn + 5 });
  put(ann, ['transport']);
  // Bob comes with a scout: Ann's world is hostile to him - no salvage.
  put(bob, ['scout']);
  resolveTurn(g);
  assert(ann.ledger.salvage === salvageRate(90, true), `Transporter salvaged ${ann.ledger.salvage} instead of ${salvageRate(90, true)}`);
  assert(bob.ledger.salvage === 0, 'Salvage under the guns of a hostile world');
  // Allied, Bob takes his share.
  offerAlliance(g, ann, bob.id, false);
  answerOffer(g, bob, ann.id, true);
  g.fleets = g.fleets.filter(f => f.owner !== ALIEN_ID);
  put(bob, ['scout']);
  const left = wreckAt(g, world.id).metal;
  resolveTurn(g);
  const got = ann.ledger.salvage + bob.ledger.salvage;
  assert(g.alliances.length === 1, 'No alliance for the test');
  assert(got === left && bob.ledger.salvage > 0 && ann.ledger.salvage > bob.ledger.salvage,
    `Allies did not share the rest (${ann.ledger.salvage} + ${bob.ledger.salvage} of ${left})`);
  assert(!wreckAt(g, world.id), 'The wreck is not empty');
  // A wreck nobody comes for breaks up after its time.
  const lone = colonies(g, cid)[0];
  wrecksOf(g).push({ planetId: lone.id, metal: 50, total: 50, born: g.turn - 1, until: g.turn });
  const gone = resolveTurn(g);
  assert(!wreckAt(g, lone.id) && gone.some(e => e.key === 'log.wreckGone'), 'An old wreck did not break up');
  console.log(`Wreck: transporter ${salvageRate(90, true)}/turn, allies shared ${left}, an old one broke up.`);
}

// 14) Shot down in open space: the victor's fleet takes the wreck on the spot
{
  const g = setup();
  g.settings.aliens = false;
  const ann = g.players[0];
  const world = colonies(g, ann)[0];
  const tech = { weapons: 3, shields: 3, speed: 2 };
  const al = swarmAt(g, world, 1, tech);
  al.at = null; al.x = world.x + 300; al.y = world.y; al.dest = world.id;
  const hunter = newFleet(g, ann.id, world);
  for (let i = 0; i < 10; i++) addShip(g, hunter, 'fighter', ann.tech);
  setOrders(g, ann, { move: { fleetId: hunter.id, chase: al.id } });
  let taken = null;
  for (let t = 0; t < 6 && !taken; t++) {
    const entries = resolveTurn(g);
    taken = entries.find(e => e.key === 'log.wreckTaken');
    if (taken) assert(ann.ledger.salvage === wreckMetal(tech), `Took ${ann.ledger.salvage} instead of ${wreckMetal(tech)}`);
  }
  assert(taken, 'No wreck taken after a battle in open space');
  assert(!wrecksOf(g).length, 'A wreck in open space stayed on the map');
  console.log(`Open space: ${taken?.params.metal} metal taken on the spot.`);
}

if (errors) { console.error(`\n${errors} alien checks failed.`); process.exit(1); }
console.log('\nAll alien checks passed.');
