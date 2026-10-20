// Haushalt einer Runde: was am Rundenende mit Geld und Metall geschieht.
//
// Rechnet aus der Spielersicht (server/game.js buildView) Schritt fuer
// Schritt nach, was resolveTurn abbucht - in derselben Reihenfolge und mit
// denselben Regeln: Forschung, Schiffsbau, Umrüstung, Terraforming, zuletzt
// Einnahmen und Förderung. Der Client zeigt damit Kopfleiste, Werft und
// Haushalt; test/budget.js haelt es gegen das, was der Server wirklich bucht.
//
// Was hier nicht vorhersehbar ist: Kampf, Eroberung und neue Kolonien
// zwischen Bau und Abrechnung - sie aendern nur die Einnahmen.
import {
  TECH_FIELDS, TECH_MAX_LEVEL, techCostToNext, SHIP_TYPES, shipCost, refitCost,
  terraformable, IDEAL, TERRA_COST_PER_DEGREE, TERRA_COST_PER_G, planetIncome, planetMining
} from './rules.js';

/**
 * Techstand nach der Forschung dieser Runde. Ein Schiff kostet nach dem Stand
 * zum Bauzeitpunkt, und der Server forscht vor dem Bau.
 */
export function researchStep(me) {
  const gewichte = TECH_FIELDS.reduce((a, f) => a + me.research.weights[f], 0);
  const budget = Math.min(me.money, Math.floor(me.money * me.research.budgetPct / 100));
  const tech = { ...me.tech };
  // Ohne Gewichtung gibt der Server das Budget wieder frei.
  if (budget <= 0 || gewichte <= 0) return { tech, budget: 0, durchbruch: false };
  let durchbruch = false;
  for (const f of TECH_FIELDS) {
    const anteil = budget * me.research.weights[f] / gewichte;
    if (anteil <= 0) continue;
    let punkte = (me.techProgress?.[f]?.points || 0) + anteil;
    while (tech[f] < TECH_MAX_LEVEL && punkte >= techCostToNext(tech[f])) {
      punkte -= techCostToNext(tech[f]);
      tech[f]++;
      durchbruch = true;
    }
  }
  return { tech, budget, durchbruch };
}

/** Kann auf dieser Welt gebaut oder umgerüstet werden? Wie der Server. */
function werft(view, planetId) {
  const w = view.planets[planetId];
  return !!w && w.owner === view.you && w.pop >= 1;
}

/** Die Schiffe hinter einem Umrüstauftrag ('f:<flotte>' oder 'p:<welt>'). */
export function refitShips(view, key) {
  if (key.startsWith('f:')) {
    const f = view.fleets.find(x => x.mine && x.id === key.slice(2));
    return f && f.at != null && werft(view, f.at) ? f.ships : [];
  }
  const id = Number(key.slice(2));
  return werft(view, id) ? (view.planets[id].defenseShips || []) : [];
}

/**
 * Der ganze Haushalt. Betraege ungerundet; `geplant` ist, was in Auftrag
 * steht, `gebucht`, was davon bezahlbar ist.
 */
export function forecast(view) {
  const me = view.me;
  const { tech, budget: forschung, durchbruch } = researchStep(me);
  let geld = me.money - forschung, metall = me.metal;
  const verfuegbar = { geld, metall };

  // Gezaehlt wird auch, woran es scheitert - "zu wenig Metall" soll nur
  // dastehen, wenn wirklich das Metall nicht reicht.
  const topf = () => ({ geplant: { geld: 0, metall: 0, n: 0 }, gebucht: { geld: 0, metall: 0, n: 0 },
    ohneGeld: false, ohneMetall: false });
  const bau = topf(), umr = topf();
  const buche = (t, c) => {
    t.geplant.geld += c.money; t.geplant.metall += c.metal; t.geplant.n++;
    if (geld < c.money || metall < c.metal) {
      if (geld < c.money) t.ohneGeld = true;
      if (metall < c.metal) t.ohneMetall = true;
      return false;
    }
    geld -= c.money; metall -= c.metal;
    t.gebucht.geld += c.money; t.gebucht.metall += c.metal; t.gebucht.n++;
    return true;
  };

  // Bau: Welt fuer Welt, je Typ so viele wie bezahlbar - nach dem ersten,
  // der nicht mehr geht, bleibt der Rest dieses Typs liegen.
  for (const [pid, q] of Object.entries(me.builds || {})) {
    if (!werft(view, pid)) continue;
    for (const typ of SHIP_TYPES) {
      const c = shipCost(typ, tech);
      let pleite = false;
      for (let i = 0; i < (q[typ] || 0); i++) {
        if (pleite) { bau.geplant.geld += c.money; bau.geplant.metall += c.metal; bau.geplant.n++; continue; }
        pleite = !buche(bau, c);
      }
    }
  }
  // Umrüstung: Schiff fuer Schiff; was nicht bezahlbar ist, wird uebersprungen.
  for (const key of Object.keys(me.refit || {})) {
    for (const s of refitShips(view, key)) {
      const c = refitCost(s.type, s.tech || {}, tech);
      if (c) buche(umr, c);
    }
  }
  // Terraforming: je Welt bis zum eingestellten Budget, solange Geld da ist.
  // Die neuen Werte gelten schon fuer die Einnahmen dieser Runde.
  const terra = { geplant: 0, gebucht: 0, welten: 0 };
  const nachTerra = new Map();
  for (const w of view.planets) {
    if (w.owner !== view.you || !w.terraBudget) continue;
    const ok = terraformable(w, tech.radical);
    const dT = w.temp - IDEAL.temp, dG = w.grav - IDEAL.grav;
    const noetigT = ok.temp ? Math.abs(dT) * TERRA_COST_PER_DEGREE : 0;
    const noetigG = ok.grav ? Math.abs(dG) * TERRA_COST_PER_G : 0;
    const noetig = noetigT + noetigG;
    if (noetig <= 0) continue;
    const soll = Math.min(w.terraBudget, noetig);
    terra.geplant += soll; terra.welten++;
    const budget = Math.min(w.terraBudget, geld);
    if (budget <= 0) continue;
    const ist = Math.min(budget, noetig);
    geld -= ist; terra.gebucht += ist;
    // Wirkung wie auf dem Server, samt Rundung
    const anteilT = noetigT / noetig;
    let temp = w.temp, grav = w.grav;
    const sT = ist * anteilT, sG = ist - sT;
    if (sT > 0) {
      const grad = sT / TERRA_COST_PER_DEGREE;
      temp += dT > 0 ? -Math.min(grad, Math.abs(dT)) : Math.min(grad, Math.abs(dT));
      temp = Math.round(temp * 10) / 10;
    }
    if (sG > 0) {
      const g = sG / TERRA_COST_PER_G;
      grav += dG > 0 ? -Math.min(g, Math.abs(dG)) : Math.min(g, Math.abs(dG));
      grav = Math.round(grav * 1000) / 1000;
    }
    // Am Ziel rastet der Server genau auf das Ideal ein.
    if (Math.abs(temp - IDEAL.temp) < 0.05 && Math.abs(grav - IDEAL.grav) < 0.002) { temp = IDEAL.temp; grav = IDEAL.grav; }
    nachTerra.set(w.id, { ...w, temp, grav });
  }

  const mine = view.planets.filter(p => p.owner === view.you).map(p => nachTerra.get(p.id) || p);
  const einnahmen = mine.reduce((a, p) => a + planetIncome(p), 0);
  const foerderung = mine.reduce((a, p) => a + planetMining(p), 0);

  return {
    tech, durchbruch, forschung, verfuegbar,
    bau, umr, terra, einnahmen, foerderung,
    nachTerra,
    danach: { geld: geld + einnahmen, metall: metall + foerderung }
  };
}
