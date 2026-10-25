// Splitting in flight. A fleet under way can be split like one in orbit:
// both parts fly on to the same target, and the new one can then take a
// course of its own. A fleet that holds position in space splits into parts
// that hold position too. Hard AI empires use it for surprises: a strike
// fleet with firepower to spare peels off a detachment against a second
// world it reaches in the same turn, and fighters split off to meet a small
// foreign fleet at the free world it heads for. The normal AI does neither.
import { createGame, addPlayer, startGame, resolveTurn, setOrders, canReach } from '../server/game.js';
import { runBot } from '../server/bot.js';
import { shipStats, dist } from '../shared/rules.js';

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } };

function fighters(g, owner, n) {
  const p = g.players.find(q => q.id === owner);
  const st = shipStats('fighter', p.tech);
  return Array.from({ length: n }, () => ({ id: 's' + g.nextShipId++, type: 'fighter', tech: { ...p.tech },
    hp: st.maxHp, maxHp: st.maxHp, attack: st.attack, speed: Math.round(st.speed), range: Math.round(st.range), colonists: 0 }));
}

function fleetIn(g, owner, ships, pos, dest) {
  const f = { id: 'f' + g.nextFleetId++, owner, ships, at: null, x: pos.x, y: pos.y, z: pos.z || 0, dest };
  g.fleets.push(f);
  return f;
}

/** A point `d` away from `from`, on the way to `to`. */
function toward(from, to, d) {
  const len = dist(from, to);
  const k = d / len;
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: (from.z || 0) + ((to.z || 0) - (from.z || 0)) * k };
}

function setup(level) {
  const g = createGame('Split');
  Object.assign(g.settings, { seed: 2, turnTimer: 0, maxTurns: 0, expanding: false });
  const bot = addPlayer(g, { isBot: true, persona: 'conqueror', level });
  const foe = addPlayer(g, { name: 'Foe' });
  startGame(g);
  const home = g.galaxy.planets[bot.homeworld];
  // Free worlds a fighter can reach from the home world, nearest first.
  const probe = { owner: bot.id, ships: fighters(g, bot.id, 1) };
  const near = g.galaxy.planets.filter(p => !p.owner && canReach(g, probe, p).ok)
    .sort((a, b) => dist(a, home) - dist(b, home));
  return { g, bot, foe, home, near };
}

// ---------------------------------------------------------------- Rules
{
  const { g, bot: me, home, near } = setup('normal');
  me.isBot = false;
  const [a, b] = near;
  const f = fleetIn(g, me.id, fighters(g, me.id, 4), toward(home, a, 20), a.id);
  const take = f.ships.slice(0, 2).map(s => s.id);
  const r = setOrders(g, me, { split: { fleetId: f.id, ships: take } });
  const part = g.fleets.find(x => x.id === r?.newFleet);
  assert(part, 'Split in flight did not happen');
  assert(part && part.at == null && part.x === f.x && part.y === f.y, 'The part split off in flight should stand where the fleet is');
  assert(part && part.dest === a.id && f.dest === a.id, 'Both parts should keep the course after a split in flight');
  assert(f.ships.length === 2 && part?.ships.length === 2, 'Ships were not divided 2 : 2');
  const turn = setOrders(g, me, { move: { fleetId: part.id, planetId: b.id } });
  assert(!turn?.error && part.dest === b.id, `The part split off could not take a course of its own (${turn?.error})`);
  const before = { x: part.x, y: part.y };
  resolveTurn(g);
  assert(part.x !== before.x || part.y !== before.y || part.at === b.id, 'The part split off did not fly');
  assert(dist(part, b) < dist(before, b), 'The part split off did not fly towards its own target');

  // Holding position in space: the parts hold position too.
  const still = fleetIn(g, me.id, fighters(g, me.id, 3), toward(home, b, 30), null);
  const r2 = setOrders(g, me, { split: { fleetId: still.id, ships: [still.ships[0].id], each: true } });
  const p2 = g.fleets.find(x => x.id === r2?.newFleet);
  assert(p2 && p2.dest == null && p2.at == null, 'Split of a fleet holding position in space should hold position too');
  // Never the whole fleet, never someone else's.
  const n = g.fleets.length;
  setOrders(g, me, { split: { fleetId: still.id, ships: still.ships.map(s => s.id) } });
  assert(g.fleets.length === n, 'A split took every ship of the fleet');
  const other = g.players.find(p => p.id !== me.id);
  setOrders(g, other, { split: { fleetId: still.id, ships: [still.ships[0].id] } });
  assert(g.fleets.length === n, 'Someone split a fleet that is not theirs');
  console.log('Rules: split in flight keeps the course for both parts, the new part flies its own course; holding position stays holding.');
}

// ---------------------------------------------------------------- Sortie
function sortie(level) {
  const { g, bot, foe, home, near } = setup(level);
  const [weak, goal] = near;
  Object.assign(goal, { owner: foe.id, pop: 3 });
  Object.assign(weak, { owner: foe.id, pop: 0.5 });
  bot.explored.add(goal.id); bot.explored.add(weak.id);
  // Half a turn short of the weak world, on the way to the real target.
  const f = fleetIn(g, bot.id, fighters(g, bot.id, 30), toward(weak, goal, 15), goal.id);
  runBot(g, bot);
  const out = g.fleets.filter(x => x.owner === bot.id && x !== f && x.dest === weak.id);
  return { g, f, goal, weak, out };
}
{
  const hard = sortie('hard');
  assert(hard.out.length === 1, `Hard AI did not peel off a detachment against the weak world (${hard.out.length})`);
  const d = hard.out[0];
  if (d) {
    assert(d.ships.length < 30 && hard.f.ships.length >= 1, 'Detachment took the whole fleet');
    assert(hard.f.dest === hard.goal.id, 'The main fleet lost its course after the sortie');
    assert(d.ships.length <= 6, `Detachment much bigger than needed (${d.ships.length} fighters against a world with 0.5)`);
    resolveTurn(hard.g);
    assert(hard.weak.owner === d.owner, 'The sortie did not take the weak world in the same turn');
  }
  const normal = sortie('normal');
  assert(normal.out.length === 0, 'Normal AI split in flight - only hard empires should');
  console.log(`Sortie: hard AI peels off ${hard.out[0]?.ships.length} of 30 fighters and takes the weak world in passing; normal AI does not.`);
}

// ---------------------------------------------------------------- Ambush
function ambush(level) {
  const { g, bot, foe, home, near } = setup(level);
  const w = near[0];
  // A colony of the foe close by, so its colony ship has the range.
  Object.assign(near[1], { owner: foe.id, pop: 3 });
  const settler = g.fleets.find(f => f.owner === foe.id && f.ships.some(s => s.colonists > 0));
  // The colony ship arrives in two turns, the bot fleet passes nearby on its way home.
  const cs = settler.ships[0].speed;
  Object.assign(settler, { at: null, dest: w.id, ...toward(w, home, cs * 1.6) });
  settler.x += 30; settler.y += 30;
  const f = fleetIn(g, bot.id, fighters(g, bot.id, 8), toward(w, { x: w.x - 300, y: w.y - 300, z: w.z || 0 }, 20), home.id);
  runBot(g, bot);
  const out = g.fleets.filter(x => x.owner === bot.id && x !== f && x.dest === w.id);
  for (let t = 0; t < 3; t++) resolveTurn(g);
  return { out, colonized: w.owner === foe.id, settlerAlive: g.fleets.includes(settler) && settler.ships.length > 0 };
}
{
  const hard = ambush('hard');
  assert(hard.out.length === 1, `Hard AI did not send fighters to meet the colony ship (${hard.out.length})`);
  assert(!hard.colonized && !hard.settlerAlive, 'The colony ship got through the ambush');
  const normal = ambush('normal');
  assert(normal.out.length === 0, 'Normal AI laid an ambush - only hard empires should');
  assert(normal.colonized, 'Without an ambush the colony ship should settle (scenario broken)');
  console.log(`Ambush: hard AI splits off ${hard.out[0]?.ships.length} fighters, the colony ship is shot down at the free world; normal AI lets it settle.`);
}

if (errors) { console.error(`${errors} error(s)`); process.exit(1); }
console.log('OK');
