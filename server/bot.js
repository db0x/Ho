// Einfache, aber brauchbare KI. Sie benutzt nur Planeten, die sie selbst
// erkundet hat, und spielt nach den gleichen Regeln wie Menschen.
import {
  shipCost, planetCapacity, terraformFullCost, dist, batteryStats, COMBAT_ROUNDS,
  holeZone, travelDistance
} from '../shared/rules.js';
import { setOrders, fleetStats, canReach, planetById, playerById } from './game.js';

// Anteil der Feuerkraft, der in zwölf Kampfrunden wirklich ankommt - der Rest
// geht durch eigene Verluste und Überschuss auf schon zerstörte Ziele verloren.
// An der Simulation geeicht: 25 Jäger knacken eine Heimatwelt mit 50 Mio.
const TREFFERQUOTE = 0.72;
// Ab wie wenigen bekannten Welten ein Reich als angeschlagen gilt und zum
// Kriegsziel wird. Drei ist gemessen das Optimum: bei zwei schlüpft das Opfer
// durch Neukolonien immer wieder heraus, bei vier und mehr wechseln die Bots
// zu oft das Ziel und sammeln nie genug.
const ANGESCHLAGEN = 3;

export function runBot(game, bot) {
  const planets = game.galaxy.planets;
  // Einmal durchzählen statt fünfmal - bei tausend Welten und hunderten
  // Flotten je Runde macht das den Unterschied.
  const meineFlotten = game.fleets.filter(f => f.owner === bot.id);
  const mine = planets.filter(p => p.owner === bot.id);
  const known = planets.filter(p => bot.explored.has(p.id));
  const openWorlds = known.filter(p => !p.owner);
  const enemyWorlds = known.filter(p => p.owner && p.owner !== bot.id);
  const early = game.turn < 30;

  // --- Forschung: Schwerpunkt wandert mit dem Spielverlauf
  const weights = early
    ? { range: 3, speed: 2, weapons: 1, shields: 1, mini: 2, radical: 3 }
    : { range: 2, speed: 2, weapons: 3, shields: 3, mini: 2, radical: 3 };
  setOrders(game, bot, { research: { budgetPct: early ? 45 : 32, weights } });

  // --- Terraforming: zuerst die billigsten Verbesserungen
  const terraBudget = bot.money * (early ? 0.3 : 0.4);
  const candidates = mine
    .map(p => ({ p, cost: terraformFullCost(p, bot.tech.radical) }))
    .sort((a, b) => a.cost - b.cost);
  let left = terraBudget;
  for (const c of candidates) {
    const give = c.cost > 0 ? Math.min(left, c.cost) : 0;
    setOrders(game, bot, { terraform: { planetId: c.p.id, budget: Math.round(give) } });
    left = Math.max(0, left - give);
  }

  // --- Bau: Expansion hat Vorrang, danach Militär
  const myColonyShips = meineFlotten
    .reduce((a, f) => a + f.ships.filter(s => s.colonists > 0).length, 0);
  const wantColony = Math.max(0, Math.min(3, openWorlds.length - myColonyShips));
  const threat = enemyWorlds.some(p => mine.some(m => dist(m, p) < 450));
  const myShips = meineFlotten.reduce((a, f) => a + f.ships.length, 0);

  // --- Lagebild: Was kostet welche Feindwelt, und wer liegt am Boden?
  // Die Abwehrbatterie wird jede Runde neu aus der Bevölkerung aufgebaut -
  // belagern bringt nichts, man muss sie in einem Zug brechen.
  const heimflotte = new Map();
  for (const f of game.fleets) {
    if (f.at === null || f.at === undefined) continue;
    const pl = planets[f.at];
    if (!pl || pl.owner !== f.owner) continue;
    heimflotte.set(f.at, (heimflotte.get(f.at) || 0) + f.ships.reduce((a, s) => a + s.maxHp, 0));
  }
  const wehrkraft = new Map();     // Welt -> Trefferpunkte, die wegmüssen
  const restWelten = new Map();    // Reich -> wie viele seiner Welten die KI kennt
  for (const p of enemyWorlds) {
    const halter = playerById(game, p.owner);
    const bs = halter ? batteryStats(p.pop, halter.tech) : null;
    let hp = bs ? bs.hp : 0;
    if (p.defenses) for (const s of p.defenses) hp += s.maxHp;
    wehrkraft.set(p.id, hp + (heimflotte.get(p.id) || 0));
    restWelten.set(p.owner, (restWelten.get(p.owner) || 0) + 1);
  }

  // Steht ein Reich kurz vor dem Aus, wird daraus ein Kriegsziel: dafür lohnt
  // es sich, die Flotten zu sammeln, statt nebenbei Randkolonien zu nehmen.
  let kriegsziel = null;
  for (const p of enemyWorlds) {
    if ((restWelten.get(p.owner) || 99) > ANGESCHLAGEN) continue;
    const kosten = wehrkraft.get(p.id) || 0;
    if (!kriegsziel || kosten < kriegsziel.kosten) kriegsziel = { p, kosten };
  }
  // Nur, wenn das Reich insgesamt genug Feuerkraft hat - sonst wartet es ewig.
  const gesamteSchlagkraft = meineFlotten
    .reduce((a, f) => a + f.ships.reduce((b, s) => b + s.attack, 0), 0) * COMBAT_ROUNDS * TREFFERQUOTE;
  if (kriegsziel && gesamteSchlagkraft < kriegsziel.kosten) kriegsziel = null;

  const yards = mine.filter(p => p.pop >= 1).sort((a, b) => b.pop - a.pop);
  const yard = yards[0];
  // Gesammelt wird an der Front, wenn ein Kriegsziel ansteht
  const sammelpunkt = (kriegsziel
    && mine.filter(p => p.pop >= 1).sort((a, b) => dist(a, kriegsziel.p) - dist(b, kriegsziel.p))[0]) || yards[0];
  if (yard) {
    const budget = bot.money * 0.55;
    const order = [];
    if (game.turn < 6) order.push(['scout', 2]);
    else if (known.length < planets.length * 0.35 && game.turn % 7 === 0) order.push(['scout', 1]);
    if (wantColony > 0) order.push(['colony', wantColony]);
    if (threat) order.push(['satellite', 2]);
    if (enemyWorlds.length && myShips < 10 + game.turn * 0.6) order.push(['fighter', 4]);
    else if (threat) order.push(['fighter', 2]);

    let spentMoney = 0, spentMetal = 0;
    for (const [type, n] of order) {
      const c = shipCost(type, bot.tech);
      let k = 0;
      while (k < n
        && spentMoney + c.money <= budget
        && spentMetal + c.metal <= bot.metal) {
        k++; spentMoney += c.money; spentMetal += c.metal;
      }
      if (k > 0) setOrders(game, bot, { build: { planetId: yard.id, type, count: k } });
    }
  }

  // --- Flotten vor dem Angriff bündeln
  const warten = new Map();
  for (const f of meineFlotten) {
    if (f.at === null || f.at === undefined || f.dest) continue;
    warten.set(f.at, (warten.get(f.at) || 0) + 1);
  }
  for (const p of mine) {
    if ((warten.get(p.id) || 0) > 1) setOrders(game, bot, { merge: { planetId: p.id } });
  }

  // --- Flottenbefehle
  const zone = holeZone(game.galaxy);
  for (const fleet of game.fleets.filter(f => f.owner === bot.id && !f.dest && f.ships.length)) {
    // (meineFlotten ist von vor dem Zusammenlegen - hier zählt der aktuelle Stand)
    const st = fleetStats(fleet);
    if (st.speed <= 0) continue;
    const here = fleet.at !== null ? planetById(game, fleet.at) : fleet;
    // Entfernung heisst fuer die KI: der Weg, den sie wirklich fliegen muss.
    const weit = p => travelDistance(here, p, zone);
    const hasColonist = fleet.ships.some(s => s.colonists > 0);
    const armed = st.attack > 0;
    let target = null;

    if (hasColonist) {
      // Siedler: möglichst gute, freie Welt
      target = reachable(game, fleet, openWorlds.filter(p => p.id !== fleet.at),
        p => planetCapacity(p) * 8 - weit(p) * 0.1);
    } else if (!armed) {
      // Späher: nächste unerkundete Welt
      target = reachable(game, fleet, planets.filter(p => !bot.explored.has(p.id)),
        p => -weit(p));
      if (!target) target = reachable(game, fleet, enemyWorlds, p => -weit(p));
    } else if (armed && enemyWorlds.length) {
      // Nur Ziele, die diese Flotte in einem Zug knacken kann - gegen eine
      // Welt, die sie nicht bricht, verliert sie die Flotte umsonst. Die
      // Abwehrbatterie steht in der nächsten Runde wieder voll da.
      const schlagkraft = st.attack * COMBAT_ROUNDS * TREFFERQUOTE;
      if (kriegsziel) {
        // Alles auf den Gnadenstoß: entweder diese Flotte reicht, oder sie
        // wartet am Sammelpunkt, bis genug beisammen ist.
        if (schlagkraft >= kriegsziel.kosten && canReach(game, fleet, kriegsziel.p).ok) {
          target = kriegsziel.p;
        }
      } else {
        target = reachable(game, fleet, enemyWorlds.filter(p => (wehrkraft.get(p.id) || 0) <= schlagkraft),
          p => -(p.pop * 1.5 + (p.defenses ? p.defenses.length * 8 : 0)) - weit(p) * 0.06);
      }
    }
    if (!target && armed) {
      // Nichts zu holen: sammeln, bis die Flotte stark genug ist
      if (sammelpunkt && sammelpunkt.id !== fleet.at) {
        target = canReach(game, fleet, sammelpunkt).ok ? sammelpunkt : null;
      }
    }
    if (target && target.id !== fleet.at) {
      setOrders(game, bot, { move: { fleetId: fleet.id, planetId: target.id } });
    }
  }

  bot.ready = true;
}

/** Bestes Ziel, das die Flotte auch erreichen kann. */
function reachable(game, fleet, arr, score) {
  const sorted = arr.slice().sort((a, b) => score(b) - score(a));
  for (const p of sorted.slice(0, 12)) {
    if (canReach(game, fleet, p).ok) return p;
  }
  return null;
}
