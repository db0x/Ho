// Stimmt der Haushalt? Die Vorschau im Client (shared/budget.js) gegen das,
// was der Server am Rundenende wirklich bucht - Posten fuer Posten, ueber
// viele Runden mit zufaelligen Auftraegen. Dazu die Gegenprobe: der neue
// Kontostand muss sich vollstaendig aus diesen Posten erklaeren, sonst fliesst
// irgendwo Geld ab, das keine Anzeige kennt.
import {
  createGame, addPlayer, startGame, setOrders, resolveTurn, buildView
} from '../server/game.js';
import { runBot } from '../server/bot.js';
import { forecast } from '../shared/budget.js';
import { SHIP_TYPES, TECH_FIELDS } from '../shared/rules.js';

let fehler = 0;
const rüge = (msg) => { if (fehler < 25) console.error('FEHLER: ' + msg); fehler++; };
const nah = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// Eigener Zufall, damit ein Fehler sich nachstellen laesst
let saat = Number(process.env.HO_SEED) || 12345;      // HO_SEED=... fuer andere Verlaeufe
const zufall = () => ((saat = (saat * 1103515245 + 12345) % 2147483648) / 2147483648);
const eins = (arr) => arr[Math.floor(zufall() * arr.length)];

// Ereignisse, nach denen sich die Einnahmen nicht mehr vorhersagen lassen
const STOERT = new Set(['combat', 'invade', 'colonize', 'settle', 'lost', 'eliminated']);

let runden = 0, vergleiche = 0, einnahmenGeprueft = 0, terraGebucht = 0, umruestGebucht = 0;
const abgewiesen = { bau: 0, umruest: 0, forschung: 0 };
// Auftrag ueber setOrders, und mitzaehlen, was der Server ablehnt
const befehl = (game, p, msg) => {
  const r = setOrders(game, p, msg);
  if (r?.error === 'notice.buildUnaffordable') abgewiesen.bau++;
  if (r?.error === 'notice.refitUnaffordable') abgewiesen.umruest++;
  if (r?.error === 'notice.researchCapped') abgewiesen.forschung++;
};

for (let partie = 0; partie < 6; partie++) {
  const game = createGame('Test');
  Object.assign(game.settings, { planetsPerPlayer: 6, turnTimer: 0, maxTurns: 0, startMoney: 400 + partie * 900 });
  for (let i = 0; i < 6; i++) addPlayer(game, { isBot: true });
  const r = startGame(game);
  if (r.error) { rüge('Start: ' + r.error); continue; }

  for (let runde = 0; runde < 70 && game.state === 'running'; runde++) {
    for (const bot of game.players.filter(p => p.isBot && p.alive)) runBot(game, bot);

    // Zusaetzliche, absichtlich auch unsinnige Auftraege
    for (const p of game.players.filter(q => q.alive)) {
      const eigene = game.galaxy.planets.filter(w => w.owner === p.id);
      if (!eigene.length) continue;
      if (zufall() < 0.4) befehl(game, p, { research: { budgetPct: eins([0, 5, 20, 40, 75, 100]) } });
      if (zufall() < 0.1) {
        befehl(game, p, { research: { weights: Object.fromEntries(TECH_FIELDS.map(f => [f, zufall() < 0.3 ? 0 : 1 + Math.floor(zufall() * 9)])) } });
      }
      if (zufall() < 0.03) befehl(game, p, { research: { weights: Object.fromEntries(TECH_FIELDS.map(f => [f, 0])) } });
      for (let k = 0; k < 3; k++) {
        if (zufall() < 0.5) befehl(game, p, { build: { planetId: eins(eigene).id, type: eins(SHIP_TYPES), count: 1 + Math.floor(zufall() * 6) } });
      }
      if (zufall() < 0.4) befehl(game, p, { terraform: { planetId: eins(eigene).id, budget: eins([0, 10, 50, 200, 900]) } });
      if (zufall() < 0.3) {
        const f = game.fleets.find(x => x.owner === p.id && x.at != null);
        if (f) befehl(game, p, { refit: { fleetId: f.id } });
      }
      if (zufall() < 0.2) befehl(game, p, { refit: { planetId: eins(eigene).id } });
      // Nach den Auftraegen den Forschungsanteil hochziehen - frueher der
      // haeufigste Weg zu "Bau unvollstaendig".
      if (zufall() < 0.3) befehl(game, p, { research: { budgetPct: 100 } });
    }

    // Vorschau aus genau der Sicht, die der Spieler bekommt
    const vorher = new Map();
    for (const p of game.players.filter(q => q.alive)) {
      const view = JSON.parse(JSON.stringify(buildView(game, p)));   // wie ueber die Leitung
      vorher.set(p.id, {
        f: forecast(view), money: p.money, metal: p.metal,
        welten: game.galaxy.planets.filter(w => w.owner === p.id).map(w => w.id).join(',')
      });
    }

    const eintraege = resolveTurn(game);
    runden++;
    for (const e of eintraege) {
      if (e.key === 'log.buildShort' || e.key === 'log.refitShort') {
        rüge(`Partie ${partie}, Runde ${game.turn - 1}: ${e.key} bei ${e.params?.planet} - darf nicht vorkommen`);
      }
    }

    for (const p of game.players) {
      const v = vorher.get(p.id);
      if (!v) continue;
      const L = p.ledger, f = v.f;
      const wo = `Partie ${partie}, Runde ${game.turn - 1}, ${p.name}`;
      vergleiche++;

      // 1) Jeder Posten wie vorhergesagt
      if (!nah(L.research, f.forschung)) rüge(`${wo}: Forschung ${L.research} statt ${f.forschung}`);
      if (!nah(L.build.money, f.bau.gebucht.geld) || !nah(L.build.metal, f.bau.gebucht.metall)) {
        rüge(`${wo}: Bau ${L.build.money}/${L.build.metal} statt ${f.bau.gebucht.geld}/${f.bau.gebucht.metall}`);
      }
      if (!nah(L.refit.money, f.umr.gebucht.geld) || !nah(L.refit.metal, f.umr.gebucht.metall)) {
        rüge(`${wo}: Umrüstung ${L.refit.money}/${L.refit.metal} statt ${f.umr.gebucht.geld}/${f.umr.gebucht.metall}`);
      }
      if (!nah(L.terra, f.terra.gebucht)) rüge(`${wo}: Terraforming ${L.terra} statt ${f.terra.gebucht}`);
      // Der Server nimmt nur Bezahlbares an - also faellt nie etwas aus.
      if (f.bau.geplant.n > f.bau.gebucht.n) rüge(`${wo}: Vorschau sagt Bauausfall voraus (${f.bau.gebucht.n}/${f.bau.geplant.n})`);
      if (f.umr.geplant.n > f.umr.gebucht.n) rüge(`${wo}: Vorschau sagt Umrüstausfall voraus`);
      if (L.terra > 0) terraGebucht++;
      if (L.refit.money > 0) umruestGebucht++;

      // 2) Einnahmen, wenn nichts dazwischenkam
      const gestoert = eintraege.some(e => STOERT.has(e.type) && (e.playerIds || []).includes(p.id));
      const welten = game.galaxy.planets.filter(w => w.owner === p.id).map(w => w.id).join(',');
      if (!gestoert && welten === v.welten) {
        einnahmenGeprueft++;
        if (!nah(L.income, f.einnahmen, 1e-6)) rüge(`${wo}: Einnahmen ${L.income} statt ${f.einnahmen}`);
        if (!nah(L.mined, f.foerderung, 1e-6)) rüge(`${wo}: Förderung ${L.mined} statt ${f.foerderung}`);
      }

      // 3) Gegenprobe: der Kontostand erklaert sich vollstaendig aus den Posten
      const geld = v.money - L.research - L.build.money - L.refit.money - L.terra + L.income;
      const metall = v.metal - L.build.metal - L.refit.metal + L.mined;
      // Der Server rundet am Ende auf eine Nachkommastelle - mehr Spiel gibt es nicht.
      if (!nah(p.money, geld, 0.05 + 1e-6)) rüge(`${wo}: Geld ${p.money}, aus den Posten ${geld}`);
      if (!nah(p.metal, metall, 0.05 + 1e-6)) rüge(`${wo}: Metall ${p.metal}, aus den Posten ${metall}`);
      if (p.money < -1e-9 || p.metal < -1e-9) rüge(`${wo}: Kontostand negativ (${p.money} / ${p.metal})`);
    }
  }
}

console.log(`${runden} Runden, ${vergleiche} Haushalte verglichen, Einnahmen ${einnahmenGeprueft}× ungestört geprüft.`);
console.log(`Mit Terraforming: ${terraGebucht}, mit Umrüstung: ${umruestGebucht}. Abgewiesen: ${abgewiesen.bau} Bau, ${abgewiesen.umruest} Umrüstung, Forschung ${abgewiesen.forschung}× gedeckelt.`);
if (!terraGebucht || !umruestGebucht || !abgewiesen.bau || !abgewiesen.forschung) rüge('Testlauf deckt nicht alle Fälle ab');
if (fehler) { console.error(`${fehler} Abweichungen.`); process.exit(1); }
console.log('Haushalt: Vorschau und Abrechnung stimmen Posten für Posten überein, kein Auftrag fällt aus.');
