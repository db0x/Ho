// Does the budget add up? The client's forecast (shared/budget.js) against what
// the server really books at the end of the turn - item by item, over many
// turns with random orders. Plus the cross-check: the new balance must be
// fully explained by these items, otherwise money drains away somewhere that
// no display knows about.
import {
  createGame, addPlayer, startGame, setOrders, resolveTurn, buildView
} from '../server/game.js';
import { runBot } from '../server/bot.js';
import { forecast } from '../shared/budget.js';
import { SHIP_TYPES, TECH_FIELDS } from '../shared/rules.js';

let errors = 0;
const fail = (msg) => { if (errors < 25) console.error('ERROR: ' + msg); errors++; };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// Own randomness so a failure can be reproduced
let seed = Number(process.env.HO_SEED) || 12345;      // HO_SEED=... for other runs
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (arr) => arr[Math.floor(random() * arr.length)];

// Events after which the income can no longer be predicted
const DISTURBS = new Set(['combat', 'invade', 'colonize', 'settle', 'lost', 'eliminated']);

let turns = 0, comparisons = 0, incomeChecked = 0, terraBooked = 0, refitBooked = 0;
const rejected = { build: 0, refit: 0, research: 0 };
// Order via setOrders, and count what the server rejects
const order = (game, p, msg) => {
  const r = setOrders(game, p, msg);
  if (r?.error === 'notice.buildUnaffordable') rejected.build++;
  if (r?.error === 'notice.refitUnaffordable') rejected.refit++;
  if (r?.error === 'notice.researchCapped') rejected.research++;
};

for (let gameNo = 0; gameNo < 6; gameNo++) {
  const game = createGame('Test');
  Object.assign(game.settings, { planetsPerPlayer: 6, turnTimer: 0, maxTurns: 0, startMoney: 400 + gameNo * 900 });
  for (let i = 0; i < 6; i++) addPlayer(game, { isBot: true });
  const r = startGame(game);
  if (r.error) { fail('Start: ' + r.error); continue; }

  for (let turn = 0; turn < 70 && game.state === 'running'; turn++) {
    for (const bot of game.players.filter(p => p.isBot && p.alive)) runBot(game, bot);

    // Additional orders, deliberately including nonsensical ones
    for (const p of game.players.filter(q => q.alive)) {
      const own = game.galaxy.planets.filter(w => w.owner === p.id);
      if (!own.length) continue;
      if (random() < 0.4) order(game, p, { research: { budgetPct: pick([0, 5, 20, 40, 75, 100]) } });
      if (random() < 0.1) {
        order(game, p, { research: { weights: Object.fromEntries(TECH_FIELDS.map(f => [f, random() < 0.3 ? 0 : 1 + Math.floor(random() * 9)])) } });
      }
      if (random() < 0.03) order(game, p, { research: { weights: Object.fromEntries(TECH_FIELDS.map(f => [f, 0])) } });
      for (let k = 0; k < 3; k++) {
        if (random() < 0.5) order(game, p, { build: { planetId: pick(own).id, type: pick(SHIP_TYPES), count: 1 + Math.floor(random() * 6) } });
      }
      if (random() < 0.4) order(game, p, { terraform: { planetId: pick(own).id, budget: pick([0, 10, 50, 200, 900]) } });
      if (random() < 0.3) {
        const f = game.fleets.find(x => x.owner === p.id && x.at != null);
        if (f) order(game, p, { refit: { fleetId: f.id } });
      }
      if (random() < 0.2) order(game, p, { refit: { planetId: pick(own).id } });
      // Raise the research share after the orders - formerly the most common
      // path to "build incomplete".
      if (random() < 0.3) order(game, p, { research: { budgetPct: 100 } });
    }

    // Forecast from exactly the view the player gets
    const before = new Map();
    for (const p of game.players.filter(q => q.alive)) {
      const view = JSON.parse(JSON.stringify(buildView(game, p)));   // as over the wire
      before.set(p.id, {
        f: forecast(view), money: p.money, metal: p.metal,
        worlds: game.galaxy.planets.filter(w => w.owner === p.id).map(w => w.id).join(',')
      });
    }

    const entries = resolveTurn(game);
    turns++;
    for (const e of entries) {
      if (e.key === 'log.buildShort' || e.key === 'log.refitShort') {
        fail(`Game ${gameNo}, turn ${game.turn - 1}: ${e.key} at ${e.params?.planet} - must not happen`);
      }
    }

    for (const p of game.players) {
      const v = before.get(p.id);
      if (!v) continue;
      const L = p.ledger, f = v.f;
      const where = `Game ${gameNo}, turn ${game.turn - 1}, ${p.name}`;
      comparisons++;

      // 1) Every item as predicted
      if (!near(L.research, f.research)) fail(`${where}: research ${L.research} instead of ${f.research}`);
      if (!near(L.build.money, f.build.booked.money) || !near(L.build.metal, f.build.booked.metal)) {
        fail(`${where}: build ${L.build.money}/${L.build.metal} instead of ${f.build.booked.money}/${f.build.booked.metal}`);
      }
      if (!near(L.refit.money, f.refit.booked.money) || !near(L.refit.metal, f.refit.booked.metal)) {
        fail(`${where}: refit ${L.refit.money}/${L.refit.metal} instead of ${f.refit.booked.money}/${f.refit.booked.metal}`);
      }
      if (!near(L.terra, f.terra.booked)) fail(`${where}: terraforming ${L.terra} instead of ${f.terra.booked}`);
      // The server only accepts what is affordable - so nothing is ever dropped.
      if (f.build.planned.n > f.build.booked.n) fail(`${where}: forecast predicts dropped builds (${f.build.booked.n}/${f.build.planned.n})`);
      if (f.refit.planned.n > f.refit.booked.n) fail(`${where}: forecast predicts dropped refits`);
      if (L.terra > 0) terraBooked++;
      if (L.refit.money > 0) refitBooked++;

      // 2) Income, if nothing got in the way
      const disturbed = entries.some(e => DISTURBS.has(e.type) && (e.playerIds || []).includes(p.id));
      const worlds = game.galaxy.planets.filter(w => w.owner === p.id).map(w => w.id).join(',');
      if (!disturbed && worlds === v.worlds) {
        incomeChecked++;
        if (!near(L.income, f.income, 1e-6)) fail(`${where}: income ${L.income} instead of ${f.income}`);
        if (!near(L.mined, f.mining, 1e-6)) fail(`${where}: mining ${L.mined} instead of ${f.mining}`);
      }

      // 3) Cross-check: the balance is fully explained by the items
      const money = v.money - L.research - L.build.money - L.refit.money - L.terra + L.income;
      const metal = v.metal - L.build.metal - L.refit.metal + L.mined;
      // The server rounds to one decimal at the end - there is no more slack than that.
      if (!near(p.money, money, 0.05 + 1e-6)) fail(`${where}: money ${p.money}, from the items ${money}`);
      if (!near(p.metal, metal, 0.05 + 1e-6)) fail(`${where}: metal ${p.metal}, from the items ${metal}`);
      if (p.money < -1e-9 || p.metal < -1e-9) fail(`${where}: negative balance (${p.money} / ${p.metal})`);
    }
  }
}

console.log(`${turns} turns, ${comparisons} budgets compared, income checked ${incomeChecked}× undisturbed.`);
console.log(`With terraforming: ${terraBooked}, with refits: ${refitBooked}. Rejected: ${rejected.build} builds, ${rejected.refit} refits, research capped ${rejected.research}×.`);
if (!terraBooked || !refitBooked || !rejected.build || !rejected.research) fail('Test run does not cover all cases');
if (errors) { console.error(`${errors} deviations.`); process.exit(1); }
console.log('Budget: forecast and settlement match item by item, no order is dropped.');
