// AI levels: a hard empire learns from failed strikes. A colony next door
// gets reinforcements the attacker cannot see whenever a strike is on its
// way - every attack that arrives fails. The normal AI keeps sending waves of
// about the same size; the hard one must come back clearly stronger or not at
// all. A mistake is a wave that breaks on the wall although it is not clearly
// stronger than one whose failure was already known when it set off - waves
// that were under way at the same time, or turned back, are none.
import { createGame, addPlayer, startGame, resolveTurn } from '../server/game.js';
import { runBot } from '../server/bot.js';
import { shipStats, COMBAT_ROUNDS, dist } from '../shared/rules.js';

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } };
const power = f => f.ships.reduce((a, s) => a + s.attack, 0) * COMBAT_ROUNDS * 0.72;

function play(level) {
  const g = createGame('AI');
  Object.assign(g.settings, { seed: 4242, turnTimer: 0, maxTurns: 0, expanding: false });
  const bot = addPlayer(g, { isBot: true, persona: 'conqueror', level });
  const wall = addPlayer(g, { name: 'Wall' });
  startGame(g);
  const home = g.galaxy.planets[bot.homeworld];
  const target = g.galaxy.planets.filter(p => !p.owner)
    .sort((a, b) => dist(a, home) - dist(b, home))[0];
  Object.assign(target, { owner: wall.id, pop: 3 });
  bot.explored.add(target.id);
  const model = g.fleets.find(f => f.owner === wall.id).ships[0];
  const st = shipStats('fighter', model.tech);

  const sorties = [];
  const seen = new Set();
  for (let t = 0; t < 80 && target.owner === wall.id; t++) {
    bot.money = 4000; bot.metal = 2000;
    runBot(g, bot);
    const incoming = g.fleets.filter(f => f.owner === bot.id && f.dest === target.id && f.ships.some(s => s.attack > 0));
    for (const f of incoming) if (!seen.has(f.id)) { seen.add(f.id); sorties.push({ id: f.id, strike: power(f), sent: g.turn, broke: null }); }
    // The hidden garrison: there while a strike is on its way, gone before the AI looks again.
    const garrison = { id: 'f' + g.nextFleetId++, owner: wall.id, at: target.id, x: target.x, y: target.y, z: target.z || 0, dest: null,
      ships: Array.from({ length: 80 }, () => ({ ...model, id: 's' + g.nextShipId++, type: 'fighter',
        hp: st.maxHp, maxHp: st.maxHp, attack: st.attack, speed: Math.round(st.speed), range: Math.round(st.range), colonists: 0 })) };
    if (incoming.length) g.fleets.push(garrison);
    resolveTurn(g);
    g.fleets = g.fleets.filter(f => f !== garrison);
    // Broke on the wall (in this turn): the fleet is gone, or what is left of
    // it sits there. Turned back: it is heading somewhere else.
    for (const s of sorties) {
      if (s.broke != null || s.done) continue;
      const f = g.fleets.find(x => x.id === s.id);
      if (!f || f.at === target.id) s.broke = g.turn;
      else if (f.dest !== target.id) s.done = true;
    }
    target.owner = wall.id; target.pop = Math.max(target.pop, 3);
  }
  let repeats = 0;
  for (const s of sorties) {
    if (s.broke == null) continue;
    const known = sorties.filter(o => o.broke != null && o.broke <= s.sent);
    if (known.some(o => s.strike < o.strike * 1.4)) repeats++;
  }
  return { sorties: sorties.length, repeats, lessons: bot.ai?.learn };
}

const normal = play('normal');
const hard = play('hard');
console.log(`normal: ${normal.sorties} waves, ${normal.repeats} broke although no stronger than one known to have failed`);
console.log(`hard:   ${hard.sorties} waves, ${hard.repeats} repeats, ${hard.lessons.failures} failures noted`);
assert(normal.repeats > 0, 'The scenario does not show the problem - the normal AI never repeats a failed wave');
assert(hard.sorties > 0, 'The hard AI never attacks at all');
assert(hard.repeats === 0, `The hard AI sent ${hard.repeats} waves no stronger than one that already failed`);
assert(hard.lessons.failures > 0, 'The hard AI noted no failure');

if (errors) { console.error(`\n${errors} AI checks failed.`); process.exit(1); }
console.log('\nAll AI checks passed.');
