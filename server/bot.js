// KI-Reiche mit Charakter. Sie spielen nach den gleichen Regeln wie Menschen
// und benutzen nur Welten, die sie selbst erkundet haben. Was sie
// unterscheidet, ist die Persönlichkeit: Sie bestimmt, wohin das Geld geht,
// wen das Reich angreift und wie es antwortet, wenn es selbst getroffen wird.
// Dazu kommt eine Prise Streuung je Reich, damit zwei Eroberer nicht wie
// Zwillinge spielen.
import {
  shipCost, shipStats, planetCapacity, terraformFullCost, dist, batteryStats, COMBAT_ROUNDS,
  holeZone, travelDistance, refitTotal, clamp, TECH_FIELDS, TECH_MAX_LEVEL, supplyDistance
} from '../shared/rules.js';
import { setOrders, fleetStats, canReach, planetById, playerById } from './game.js';

// Anteil der Feuerkraft, der in zwölf Kampfrunden wirklich ankommt - der Rest
// geht durch eigene Verluste und Überschuss auf schon zerstörte Ziele verloren.
// An der Simulation geeicht: 25 Jäger knacken eine Heimatwelt mit 50 Mio.
const TREFFERQUOTE = 0.72;
// Ab wie wenigen bekannten Welten ein Reich als angeschlagen gilt. Gegen so
// ein Reich lohnt der Gnadenstoß - bei mehr Welten schlüpft es durch
// Neukolonien immer wieder heraus.
const ANGESCHLAGEN = 3;

/*
 * Die Persönlichkeiten. Die Zahlen sind Neigungen, keine Gesetze - der
 * Endspieldruck schiebt sie im Lauf der Partie alle Richtung Angriff.
 *
 *   forschung  Anteil der Kasse für Forschung, früh / spät (Prozent)
 *   gewichte   Forschungsschwerpunkte, früh / spät
 *   bau        Anteil des Rests, der in Schiffe geht
 *   terra      Anteil des Rests für Terraforming
 *   siedler    Kolonieschiffe, die gleichzeitig unterwegs sein dürfen
 *   flotte     wie schnell die Flotte mit den Runden wachsen darf
 *   jaeger     Jäger je Runde
 *   satelliten Lust auf Satelliten an bedrohten Welten
 *   feldzug    'immer' | 'vergeltung' (nur wer zuschlägt, bekommt es zurück)
 *              | 'druck' (erst, wenn es sich festgefahren hat)
 *   ab         frühestens ab dieser Runde Feldzüge
 *   marge      wie viel Übermacht vor dem Losschlagen beisammen sein muss
 *   einzeln    was eine Flotte auf eigene Faust angreift: 'beute' (alles,
 *              was sie knacken kann), 'nah' (nur an der eigenen Grenze),
 *              'aas' (nur Geschwächtes), 'nie'
 *   vergeltung wie nachtragend
 *   gegenFuehrer  wie sehr es den Spitzenreiter klein halten will
 *   garnison   bleibt bei Bedrohung zu Hause (ab 0,3)
 */
const PERSONAS = {
  // Sucht sich einen Nachbarn als Rivalen und rollt ihn Welt für Welt auf.
  conqueror: {
    forschung: [32, 25],
    gewichte: [{ range: 3, speed: 2, weapons: 3, shields: 2, mini: 2, radical: 1 },
               { range: 2, speed: 2, weapons: 4, shields: 3, mini: 2, radical: 1 }],
    bau: 0.72, terra: 0.25, siedler: 3, flotte: 1.5, jaeger: 6, satelliten: 2,
    feldzug: 'immer', ab: 15, marge: 1.15, einzeln: 'beute',
    vergeltung: 1.5, gegenFuehrer: 0.4, garnison: 0
  },
  // Breitet sich aus, terraformt und wehrt sich - Krieg nur als Antwort.
  settler: {
    forschung: [36, 32],
    gewichte: [{ range: 4, speed: 2, weapons: 1, shields: 1, mini: 2, radical: 4 },
               { range: 3, speed: 2, weapons: 2, shields: 3, mini: 2, radical: 3 }],
    bau: 0.6, terra: 0.45, siedler: 5, flotte: 0.8, jaeger: 3, satelliten: 2,
    feldzug: 'vergeltung', ab: 45, marge: 1.4, einzeln: 'nah',
    vergeltung: 0.8, gegenFuehrer: 0.3, garnison: 0.4
  },
  // Forscht viel, baut wenig, rüstet um - und schlägt dann mit Qualität zu.
  technocrat: {
    forschung: [50, 40],
    gewichte: [{ range: 2, speed: 2, weapons: 3, shields: 3, mini: 3, radical: 2 },
               { range: 2, speed: 2, weapons: 4, shields: 4, mini: 3, radical: 1 }],
    bau: 0.65, terra: 0.3, siedler: 3, flotte: 0.8, jaeger: 4, satelliten: 1,
    feldzug: 'immer', ab: 70, marge: 1.3, einzeln: 'nie',
    vergeltung: 1.0, gegenFuehrer: 1.0, garnison: 0.2, umruesten: true
  },
  // Schnelle Rudel, die schwach verteidigte Kolonien überall auf der Karte
  // überfallen. Große Welten meidet er, bis es nichts anderes mehr gibt.
  raider: {
    forschung: [30, 26],
    gewichte: [{ range: 3, speed: 4, weapons: 2, shields: 1, mini: 2, radical: 1 },
               { range: 3, speed: 4, weapons: 3, shields: 2, mini: 2, radical: 1 }],
    bau: 0.75, terra: 0.2, siedler: 2, flotte: 1.4, jaeger: 5, satelliten: 0,
    feldzug: 'druck', ab: 8, marge: 1.0, einzeln: 'beute',
    vergeltung: 1.2, gegenFuehrer: 1.0, garnison: 0, rudel: true, spaeher: 5
  },
  // Satelliten an jeder Grenze. Aber kein ewiger Igel: Ist der Wall dicht,
  // bricht er mit einer großen Flotte aus.
  bulwark: {
    forschung: [38, 32],
    gewichte: [{ range: 2, speed: 1, weapons: 2, shields: 4, mini: 2, radical: 3 },
               { range: 2, speed: 2, weapons: 3, shields: 4, mini: 2, radical: 2 }],
    bau: 0.6, terra: 0.45, siedler: 3, flotte: 0.9, jaeger: 3, satelliten: 3,
    feldzug: 'immer', ab: 100, marge: 1.25, einzeln: 'nah',
    vergeltung: 1.0, gegenFuehrer: 0.5, garnison: 0.5, umruesten: true
  },
  // Wartet, bis andere sich zerfleischen, und holt sich, was übrig bleibt:
  // frisch eroberte Welten, gebrochene Batterien, Reiche am Boden.
  vulture: {
    forschung: [32, 28],
    gewichte: [{ range: 3, speed: 3, weapons: 2, shields: 2, mini: 2, radical: 2 },
               { range: 3, speed: 3, weapons: 3, shields: 2, mini: 2, radical: 1 }],
    bau: 0.7, terra: 0.3, siedler: 2, flotte: 1.2, jaeger: 4, satelliten: 1,
    feldzug: 'immer', ab: 25, marge: 1.0, einzeln: 'aas',
    vergeltung: 0.5, gegenFuehrer: 0.8, garnison: 0.1, aas: true, spaeher: 5
  }
};

export function runBot(game, bot) {
  const ai = gedaechtnis(game, bot);
  const P = ai.p;
  const planets = game.galaxy.planets;
  const zone = holeZone(game.galaxy);
  // Mitte der Karte - von hier aus gemessen liegt der Rand, an dem sie wächst.
  const g = game.galaxy;
  const mitte = g.field ? { x: g.field.cx, y: g.field.cy, z: 0 }
    : { x: (g.minX + g.maxX) / 2, y: (g.minY + g.maxY) / 2, z: 0 };
  // Ohne Rundenlimit wächst der Endspieldruck so, als wären es 300 Runden -
  // sonst gäbe es dort nichts, was das Einigeln aufbricht.
  const maxTurns = game.settings.maxTurns || 300;
  // Einmal durchzählen statt fünfmal - bei tausend Welten und hunderten
  // Flotten je Runde macht das den Unterschied.
  const meineFlotten = game.fleets.filter(f => f.owner === bot.id);
  const mine = planets.filter(p => p.owner === bot.id);
  const known = planets.filter(p => bot.explored.has(p.id));
  const openWorlds = known.filter(p => !p.owner);
  const enemyWorlds = known.filter(p => p.owner && p.owner !== bot.id);
  const early = game.turn < 30;

  const bedroht = wahrnehmen(game, bot, ai, mine, enemyWorlds);
  const getroffen = game.turn - ai.zuletztGetroffen < 8;

  // --- Endspieldruck: je später, desto weniger Geduld. Wer sich lange nicht
  // bewegt hat, verliert sie schneller - das bricht das Einigeln auf.
  let druck = clamp((game.turn / maxTurns - 0.35) / 0.35, 0, 1);
  const ruheAb = Math.max(ai.ruheSeit, maxTurns * 0.3);
  if (game.turn > ruheAb + 20) druck = Math.min(1, druck + clamp((game.turn - ruheAb - 20) / 40, 0, 0.6));
  const marge = P.marge * (1 - 0.3 * druck);
  // Spät in der Partie wird auch der Vorsichtigste angriffslustig: Wer nur
  // an der Grenze zuschlug, nimmt jetzt jede Beute, und die Garnison zieht aus.
  const einzeln = druck > 0.5 && P.einzeln !== 'aas' ? 'beute' : P.einzeln;
  const garnison = P.garnison * (1 - druck);

  // --- Forschung: Schwerpunkt wandert mit dem Spielverlauf und der Lage
  let forschung = (early ? P.forschung[0] : P.forschung[1]) * (1 - 0.35 * druck);
  const weights = { ...P.gewichte[early ? 0 : 1] };

  // Freie Welten: welche erreichen die Kolonieschiffe, und welche kennt man
  // zwar, kommt aber nicht hin? Für die zweiten wird Reichweite erforscht.
  const kolonieReich = shipStats('colony', bot.tech).range;
  const heimat = mine.filter(p => p.pop > 0.5);
  const siedelbar = openWorlds.filter(p => planetCapacity(p) >= 1);
  const inReichweite = siedelbar.filter(p => supplyDistance(heimat, p, zone) <= kolonieReich);
  if (siedelbar.length > inReichweite.length && inReichweite.length < 2) weights.range += 3;
  // Erz ist die harte Grenze: ist es knapp, gehen die letzten Brocken in
  // Kolonien auf erzreichen Welten statt in Kriegsschiffe.
  const erzKnapp = bot.metal < shipCost('colony', bot.tech).metal * 4;
  if (getroffen && P.umruesten) {
    // Getroffen? Dann wird aufgerüstet, nicht nachgebaut.
    forschung += 8; weights.weapons += 2; weights.shields += 2;
  }
  // Ausgereizte Felder bekommen nichts mehr - und ist alles ausgereizt,
  // fließt das Geld ganz in Schiffe statt in Forschung, die nichts mehr bringt.
  for (const f of TECH_FIELDS) if (bot.tech[f] >= TECH_MAX_LEVEL) weights[f] = 0;
  const offen = TECH_FIELDS.some(f => weights[f] > 0);
  forschung = offen ? Math.round(clamp(forschung, 10, 60)) : 0;
  setOrders(game, bot, { research: { budgetPct: forschung, weights } });
  const kasse = bot.money * (1 - forschung / 100);

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

  // Wie weit liegt jede Feindwelt von der nächsten eigenen Basis entfernt?
  const basen = mine.filter(p => p.pop >= 0.5);
  const abstand = new Map();
  for (const p of enemyWorlds) {
    let d = Infinity;
    for (const b of basen) { const e = dist(b, p); if (e < d) d = e; }
    abstand.set(p.id, d);
  }

  // Wer führt? Die Bilanz jedes Reichs steht für alle sichtbar in der Liste.
  const lebende = game.players.filter(p => p.alive);
  const gesamtPop = lebende.reduce((a, p) => a + p.stats.pop, 0) || 1;
  const spitze = lebende.slice().sort((a, b) => b.stats.pop - a.stats.pop)[0];
  const fuehrer = spitze && spitze.id !== bot.id && spitze.stats.pop / gesamtPop > 0.25 && lebende.length > 2
    ? spitze.id : null;

  ai.rivale = rivaleWaehlen(ai, P, enemyWorlds, abstand, fuehrer);

  // Was ist eine Feindwelt wert - aus Sicht genau dieses Reichs?
  const wert = p => {
    const o = p.owner;
    let w = p.pop * 1.5 + planetCapacity(p) * 0.5 + 5;
    w *= 1 + Math.min(3, (ai.groll[o] || 0) * 0.08 * P.vergeltung);
    if (o === ai.rivale) w *= 1.6;
    if (o === fuehrer) w *= 1 + P.gegenFuehrer;
    if ((restWelten.get(o) || 99) <= ANGESCHLAGEN) w *= 1.8;
    if (P.aas && ai.frisch.has(p.id)) w *= 2.5;
    return w;
  };

  // --- Feuerkraft: was steht da, was kommt nach?
  const jaeger = shipStats('fighter', bot.tech);
  const jaegerKosten = shipCost('fighter', bot.tech);
  const jaegerSchlag = jaeger.attack * COMBAT_ROUNDS * TREFFERQUOTE;
  const schlagkraft = f => f.ships.reduce((a, s) => a + s.attack, 0) * COMBAT_ROUNDS * TREFFERQUOTE;
  const macht = meineFlotten.reduce((a, f) => a + (fleetStats(f).speed > 0 ? schlagkraft(f) : 0), 0);
  const nachschub = Math.max(0, kasse * P.bau / jaegerKosten.money) * jaegerSchlag * 3;

  const fz = feldzugPlanen();

  // --- Terraforming: zuerst die billigsten Verbesserungen
  const candidates = mine
    .map(p => ({ p, cost: terraformFullCost(p, bot.tech.radical) }))
    .sort((a, b) => a.cost - b.cost);
  let left = kasse * P.terra * (early ? 0.8 : 1) * (1 - 0.5 * druck);
  for (const c of candidates) {
    const give = c.cost > 0 ? Math.min(left, c.cost) : 0;
    setOrders(game, bot, { terraform: { planetId: c.p.id, budget: Math.round(give) } });
    left = Math.max(0, left - give);
  }

  // --- Bau
  const yards = mine.filter(p => p.pop >= 1).sort((a, b) => b.pop - a.pop);
  const yard = yards[0];
  const front = frontwelt();
  // Ein Sammelpunkt für alles: Gebaut wird, wo gesammelt wird - sonst zieht
  // jede Runde ein neuer Strom frischer Jäger von der Werft zur Front.
  const sammelpunkt = (fz && fz.sammel) || (P.einzeln === 'beute' || P.aas ? front : yard);
  // Wache: Verteidiger halten an einer bedrohten Welt ein paar Runden aus,
  // statt jedem vorbeiziehenden Feind hinterherzufliegen und zurück.
  let wache = ai.wache && planetById(game, ai.wache.id);
  if (!wache || wache.owner !== bot.id || game.turn > ai.wache.bis) {
    wache = null; ai.wache = null;
    const ernst = [...bedroht.entries()].sort((a, b) => b[1] - a[1])[0];
    if (ernst) { ai.wache = { id: ernst[0], bis: game.turn + 6 }; wache = planetById(game, ernst[0]); }
  }
  if (yard) bauen();

  // --- Flotten vor dem Angriff bündeln
  const warten = new Map();
  for (const f of meineFlotten) {
    if (f.at === null || f.at === undefined || f.dest != null) continue;
    warten.set(f.at, (warten.get(f.at) || 0) + 1);
  }
  for (const p of mine) {
    if ((warten.get(p.id) || 0) > 1) setOrders(game, bot, { merge: { planetId: p.id } });
  }
  // ... und wieder sortieren: Siedler und Späher fliegen eigene Wege, sonst
  // zieht das Kolonieschiff die ganze Kampfflotte hinter sich her.
  for (const f of game.fleets.filter(f => f.owner === bot.id && f.dest == null && f.at != null)) {
    const siedler = f.ships.filter(s => s.colonists > 0).map(s => s.id);
    if (siedler.length && siedler.length < f.ships.length) {
      setOrders(game, bot, { split: { fleetId: f.id, ships: siedler } });
    }
    const bewaffnet = f.ships.filter(s => s.attack > 0);
    const rest = f.ships.filter(s => s.attack <= 0).map(s => s.id);
    if (bewaffnet.length && rest.length) setOrders(game, bot, { split: { fleetId: f.id, ships: rest } });
  }
  // Späher fliegen allein - im Pulk erkunden sie nur eine Welt statt mehrerer.
  for (const f of game.fleets.filter(f => f.owner === bot.id && f.dest == null && f.at != null)) {
    if (f.ships.length < 2 || !f.ships.every(s => s.type === 'scout')) continue;
    for (const s of f.ships.slice(1)) setOrders(game, bot, { split: { fleetId: f.id, ships: [s.id] } });
  }
  if (P.rudel) rudelBilden();

  // --- Flottenbefehle
  // Welten, die schon ein eigenes Kolonieschiff ansteuert - eins genügt, sonst
  // fliegen alle zur selben Welt, und die übrigen irren danach umher.
  const besetzt = new Set(meineFlotten
    .filter(f => f.dest != null && f.ships.some(s => s.colonists > 0)).map(f => f.dest));
  for (const fleet of game.fleets.filter(f => f.owner === bot.id && f.dest == null && f.ships.length)) {
    const st = fleetStats(fleet);
    if (st.speed <= 0) continue;
    const here = fleet.at !== null ? planetById(game, fleet.at) : fleet;
    // Entfernung heisst fuer die KI: der Weg, den sie wirklich fliegen muss.
    const weit = p => travelDistance(here, p, zone);
    const hasColonist = fleet.ships.some(s => s.colonists > 0);
    const armed = st.attack > 0;
    let target = null;

    if (hasColonist) {
      // Siedler: möglichst gute, freie Welt. Wer siedeln will, nimmt auch
      // weite Wege für eine gute Welt in Kauf.
      const gier = P.siedler >= 4 ? 10 : 8;
      target = reachable(game, fleet, siedelbar.filter(p => p.id !== fleet.at && !besetzt.has(p.id)),
        p => planetCapacity(p) * gier - weit(p) * 0.1
          + (erzKnapp ? Math.min(p.metalReserve, 2000) * 0.05 : 0));
    } else if (!armed) {
      // Späher: nächste unerkundete Welt. Ist ringsum alles bekannt, geht es
      // an den Rand - nur dort wächst die Karte, und mit ihr das Erz.
      // Fremde Welten erst zuletzt: deren Abwehr schießt einen Späher ab. Er
      // deckt die Welt beim Eintreffen aber noch auf - wer nur kennt, was vor
      // der eigenen Haustür liegt, findet im Spätspiel keine Ziele mehr.
      const sicher = p => !p.owner || p.owner === bot.id;
      const unbekannt = planets.filter(p => !bot.explored.has(p.id));
      target = reachable(game, fleet, unbekannt.filter(sicher), p => -weit(p));
      if (!target) target = reachable(game, fleet, unbekannt, p => -weit(p));
      if (!target && game.settings.expanding !== false) {
        target = reachable(game, fleet, planets.filter(sicher), p => dist(p, mitte));
      }
    } else {
      target = kampfziel(fleet, st, weit);
    }
    if (target && target.id !== fleet.at) {
      if (hasColonist) besetzt.add(target.id);
      setOrders(game, bot, { move: { fleetId: fleet.id, planetId: target.id } });
    }
  }

  umruesten();

  bot.ready = true;

  // ------------------------------------------------------------ Hilfen

  /** Ein Feldzug: ein Ziel, ein Sammelpunkt, und erst los, wenn es reicht. */
  function feldzugPlanen() {
    let plan = ai.feldzug;
    if (plan) {
      const z = planetById(game, plan.zielId);
      const offen = z && z.owner && z.owner !== bot.id && bot.explored.has(z.id);
      // Zu lange gewartet, oder das Ziel rüstet schneller auf, als wir
      // nachbauen: fallen lassen und eine Weile meiden.
      const zuTeuer = offen && (wehrkraft.get(z.id) || 0) * marge > (macht + nachschub) * 1.5;
      if (!offen || zuTeuer || game.turn - plan.seit > 35) {
        if (offen) ai.gemieden[z.id] = game.turn + 25;
        plan = null;
      }
    }
    const darf = (game.turn >= P.ab * (1 - druck) && (
        P.feldzug === 'immer'
        || (P.feldzug === 'vergeltung' && (getroffen || druck >= 0.5))
        || (P.feldzug === 'druck' && druck >= 0.4)))
      // Nachtragende schlagen auch früher zurück
      || (getroffen && P.vergeltung >= 1 && game.turn >= 10);
    if (!darf || !basen.length) { ai.feldzug = null; return null; }

    if (!plan) {
      const reich = jaeger.range;
      const potenzial = macht + nachschub;
      const nurRache = P.feldzug === 'vergeltung' && druck < 0.5;
      // Wie sehr der Preis zählt: Ein armes Reich nimmt, was billig ist; ein
      // reiches leistet sich die wertvollen Kernwelten - sonst knabbern im
      // Spätspiel alle nur noch an Randkolonien, und der Kern bleibt starr.
      const kostenSkala = Math.max(60, potenzial / 25);
      let best = null, billigst = null;
      for (const p of enemyWorlds) {
        const d0 = abstand.get(p.id);
        if (d0 > reich || (ai.gemieden[p.id] || 0) > game.turn) continue;
        if (nurRache && (ai.groll[p.owner] || 0) < 2) continue;
        const kosten = wehrkraft.get(p.id) || 0;
        if (!billigst || kosten < billigst.kosten) billigst = { p, kosten };
        if (kosten * marge > potenzial) continue;
        const s = wert(p) / (kosten / kostenSkala + 5) * (1 - d0 / (reich * 1.6));
        if (!best || s > best.s) best = { p, s };
      }
      // Unter Druck lieber das Billigste angehen als gar nichts.
      const wahl = best ? best.p : (druck > 0.6 && billigst ? billigst.p : null);
      if (!wahl) { ai.feldzug = null; return null; }
      plan = { zielId: wahl.id, seit: game.turn };
    }
    const ziel = planetById(game, plan.zielId);
    plan.kosten = wehrkraft.get(ziel.id) || 0;
    plan.sammel = mine.filter(p => p.pop >= 1)
      .sort((a, b) => travelDistance(a, ziel, zone) - travelDistance(b, ziel, zone))[0] || null;
    plan.ziel = ziel;
    ai.feldzug = plan;
    return plan;
  }

  /** Eigene Welt, die dem Rivalen oder dem nächsten Feind am nächsten liegt. */
  function frontwelt() {
    const feinde = enemyWorlds.filter(p => !ai.rivale || p.owner === ai.rivale);
    if (!feinde.length || !yards.length) return yard;
    let best = null, bd = Infinity;
    for (const y of yards.slice(0, 20)) {
      for (const e of feinde) {
        const d = dist(y, e);
        if (d < bd) { bd = d; best = y; }
      }
    }
    return best || yard;
  }

  function bauen() {
    const budget = kasse * P.bau;
    const myColonyShips = meineFlotten
      .reduce((a, f) => a + f.ships.filter(s => s.colonists > 0).length, 0);
    // Nur so viele Kolonieschiffe, wie es erreichbare Ziele gibt - sonst
    // stehen sie herum und haben das knappe Erz gebunden.
    const wantColony = Math.max(0, Math.min(P.siedler, inReichweite.length - myColonyShips));
    const myShips = meineFlotten.reduce((a, f) => a + f.ships.length, 0);
    let deckel = (10 + game.turn * 0.6 * P.flotte + mine.length * 1.5) * (1 + druck);
    // Ein Feldzug, dem die Feuerkraft fehlt, darf den Deckel sprengen.
    if (fz && macht < fz.kosten * marge) {
      deckel = Math.max(deckel, myShips + Math.ceil((fz.kosten * marge - macht) / jaegerSchlag));
    }
    const krieg = enemyWorlds.length > 0 || bedroht.size > 0;
    const werft = sammelpunkt || yard;

    const order = [];
    const spaeher = () => {
      // Ein paar Späher sind immer unterwegs, solange es etwas zu entdecken
      // gibt oder die Karte wachsen kann.
      // Gezählt werden nur Späher, die mit dem heutigen Stand mithalten.
      const weitGenug = shipStats('scout', bot.tech).range * 0.75;
      const unterwegs = meineFlotten.reduce((a, f) => a + f.ships.filter(s => s.type === 'scout' && s.range >= weitGenug).length, 0);
      const soll = known.length < planets.length || game.settings.expanding !== false
        ? (P.spaeher ? 3 : 2) : 0;
      if (game.turn < 6) order.push([yard, 'scout', 2]);
      else if (unterwegs < soll && game.turn % 3 === 0) order.push([yard, 'scout', 1]);
    };
    const kolonien = () => { if (wantColony > 0) order.push([yard, 'colony', wantColony]); };
    const satelliten = () => {
      if (!P.satelliten) return;
      // Bedrohte Welten zuerst, die am schwersten bedrohten vorn.
      const ziele = [...bedroht.entries()]
        .map(([id, a]) => ({ p: planetById(game, id), a }))
        .filter(x => x.p.pop >= 1)
        .sort((x, y) => y.a - x.a);
      // Das Bollwerk baut seinen Wall auch ohne akute Gefahr.
      if (P.satelliten >= 3) {
        for (const p of yards) {
          if (ziele.length >= 4) break;
          if (bedroht.has(p.id)) continue;
          if (enemyWorlds.some(e => dist(e, p) < 380)) ziele.push({ p, a: 0 });
        }
      }
      for (const { p } of ziele.slice(0, 4)) {
        const da = p.defenses ? p.defenses.length : 0;
        const platz = Math.ceil(2 + p.pop / 6 * P.satelliten) - da;
        const n = Math.min(platz, P.satelliten + (getroffen ? 1 : 0));
        if (n > 0) order.push([p, 'satellite', n]);
      }
    };
    const kampfschiffe = () => {
      // Liegt viel Geld herum, wird es in Schiffe gesteckt statt gehortet.
      const hort = Math.floor(Math.max(0, budget - 10 * jaegerKosten.money) / jaegerKosten.money * 0.4);
      const n = Math.min(P.jaeger + (fz ? 2 : 0) + hort, Math.ceil(deckel - myShips));
      if (krieg && n > 0) order.push([werft, 'fighter', n]);
      else if (bedroht.size) order.push([werft, 'fighter', 2]);
    };

    spaeher();
    if (getroffen) satelliten();
    // Kriegerische Reiche rüsten nach dem Start zuerst, dann wird gesiedelt.
    if (P.einzeln === 'beute' && game.turn >= 35 && !erzKnapp) { kampfschiffe(); kolonien(); }
    else { kolonien(); kampfschiffe(); }
    if (!getroffen) satelliten();

    // Erz ist knapper als Geld: Solange noch gesiedelt werden soll, bleibt
    // für die Kolonieschiffe der nächsten Runden etwas übrig.
    const erzReserve = wantColony > 0 ? shipCost('colony', bot.tech).metal * 2 : 0;
    let spentMoney = 0, spentMetal = 0;
    for (const [pl, type, n] of order) {
      const c = shipCost(type, bot.tech);
      const erz = type === 'colony' || type === 'scout' ? bot.metal : bot.metal - erzReserve;
      let k = 0;
      while (k < n
        && spentMoney + c.money <= budget
        && spentMetal + c.metal <= erz) {
        k++; spentMoney += c.money; spentMetal += c.metal;
      }
      if (k > 0) setOrders(game, bot, { build: { planetId: pl.id, type, count: k } });
    }
  }

  /** Der Pirat teilt große Haufen in Rudel, die einzeln auf Beute gehen. */
  function rudelBilden() {
    const groesse = Math.max(3, Math.round(3 + game.turn / 25));
    const beute = enemyWorlds.filter(p => (wehrkraft.get(p.id) || 0) <= groesse * jaegerSchlag).length;
    if (beute < 2) return;
    for (const f of game.fleets.filter(f => f.owner === bot.id && f.dest == null && f.at != null)) {
      const jaegerIds = f.ships.filter(s => s.attack > 0).map(s => s.id);
      let rudel = Math.min(Math.floor(jaegerIds.length / groesse) - 1, beute - 1, 4);
      while (rudel-- > 0) {
        setOrders(game, bot, { split: { fleetId: f.id, ships: jaegerIds.splice(0, groesse) } });
      }
    }
  }

  function kampfziel(fleet, st, weit) {
    const schlag = st.attack * COMBAT_ROUNDS * TREFFERQUOTE;
    // Garnison: Wer zu Hause bedroht wird, bleibt, wo er gebraucht wird.
    if (garnison >= 0.3 && fleet.at != null && bedroht.has(fleet.at)) return null;
    // Die Hauptstadt gibt niemand preis - mit ihr bräche die halbe Wirtschaft weg.
    if (yard && fleet.at === yard.id && bedroht.has(yard.id)) return null;

    if (fz && schlag >= fz.kosten * marge && canReach(game, fleet, fz.ziel).ok) return fz.ziel;

    // Auf eigene Faust: nur Ziele, die diese Flotte in einem Zug knackt -
    // die Abwehrbatterie steht in der nächsten Runde wieder voll da.
    const knackbar = p => (wehrkraft.get(p.id) || 0) * marge <= schlag;
    let beute = [];
    if (einzeln === 'beute') beute = enemyWorlds.filter(knackbar);
    else if (einzeln === 'nah') beute = enemyWorlds.filter(p => knackbar(p) && abstand.get(p.id) < 260);
    else if (einzeln === 'aas') {
      beute = enemyWorlds.filter(p => knackbar(p)
        && (ai.frisch.has(p.id) || (restWelten.get(p.owner) || 99) <= ANGESCHLAGEN));
    }
    if (beute.length) {
      const t = reachable(game, fleet, beute,
        p => wert(p) / ((wehrkraft.get(p.id) || 0) / 100 + 5) - weit(p) * 0.03);
      if (t) return t;
    }

    // Nichts zu holen: sammeln - am Feldzug, an der Grenze oder zu Hause.
    let sammel = fz ? fz.sammel : null;
    if (!sammel && garnison >= 0.3) sammel = wache;
    if (!sammel) sammel = sammelpunkt;
    if (sammel && sammel.id !== fleet.at && canReach(game, fleet, sammel).ok) return sammel;
    return null;
  }

  /** Veraltete Schiffe und Satelliten nachrüsten, wenn das Geld reicht. */
  function umruesten() {
    // Wer aufs Umrüsten setzt, tut es bei jeder Verbesserung. Alle anderen
    // erst, wenn Reichweite oder Feuerkraft um ein Viertel zurückliegen -
    // sonst stehen alte Späher und Jäger herum, die nirgends mehr hinkommen.
    let frei = bot.money * (P.umruesten ? 0.25 : 0.15);
    const veraltet = s => {
      const neu = shipStats(s.type, bot.tech);
      return P.umruesten || neu.range > s.range * 1.25 || neu.attack > s.attack * 1.25;
    };
    for (const f of game.fleets.filter(f => f.owner === bot.id && f.dest == null && f.at != null)) {
      const pl = planetById(game, f.at);
      if (!pl || pl.owner !== bot.id || pl.pop < 1 || f.ships.some(s => s.colonists > 0)) continue;
      if (!f.ships.some(veraltet)) continue;
      const k = refitTotal(f.ships, bot.tech);
      if (!k.count || k.count < f.ships.length / 2 || k.money > frei) continue;
      setOrders(game, bot, { refit: { fleetId: f.id } });
      frei -= k.money;
    }
    for (const pl of mine) {
      if (!P.umruesten || !pl.defenses || pl.defenses.length < 2 || pl.pop < 1) continue;
      const k = refitTotal(pl.defenses, bot.tech);
      if (k.count < pl.defenses.length / 2 || k.money > frei) continue;
      setOrders(game, bot, { refit: { planetId: pl.id } });
      frei -= k.money;
    }
  }
}

/**
 * Das Gedächtnis eines KI-Reichs - es entsteht beim ersten Zug. Die Streuung
 * hängt am Seed und am Reich, damit eine Partie mit gleichem Seed gleich
 * verläuft.
 */
function gedaechtnis(game, bot) {
  if (bot.ai) return bot.ai;
  const vorlage = PERSONAS[bot.persona] || PERSONAS.conqueror;
  let s = 1;
  for (const ch of `${game.settings.seed}:${bot.id}:${bot.name}`) s = (s * 31 + ch.charCodeAt(0)) % 2147483647;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const streu = (v, f) => v * (1 + (rnd() * 2 - 1) * f);
  bot.ai = {
    p: {
      ...vorlage,
      bau: streu(vorlage.bau, 0.1), terra: streu(vorlage.terra, 0.2),
      flotte: streu(vorlage.flotte, 0.15), marge: streu(vorlage.marge, 0.1),
      ab: Math.round(streu(vorlage.ab, 0.3)), vergeltung: streu(vorlage.vergeltung, 0.3)
    },
    groll: {},              // Reich -> wie sehr es uns zugesetzt hat
    rivale: null,
    feldzug: null,
    gemieden: {},           // Welt -> bis zu welcher Runde sie kein Feldzugziel ist
    meine: new Set(),
    besitz: new Map(),      // bekannte Feindwelt -> Besitzer und Bevölkerung der Vorrunde
    frisch: new Map(),      // Welt -> Runde, in der sie den Besitzer wechselte oder einbrach
    zuletztGetroffen: -99,
    ruheSeit: game.turn,    // letzte Runde, in der eine Welt den Besitzer wechselte
    wache: null             // bedrohte Welt, die die Verteidiger gerade halten
  };
  return bot.ai;
}

/**
 * Was hat sich seit dem letzten Zug getan? Verlorene Welten wecken Groll
 * gegen den neuen Besitzer, anfliegende Kampfflotten auch ein wenig.
 * Zurück kommen die bedrohten eigenen Welten mit der Feuerkraft, die auf sie
 * zuhält.
 */
function wahrnehmen(game, bot, ai, mine, enemyWorlds) {
  const jetzt = new Set(mine.map(p => p.id));
  for (const id of ai.meine) {
    if (jetzt.has(id)) continue;
    const pl = planetById(game, id);
    if (!pl.owner || pl.owner === bot.id) continue;
    ai.groll[pl.owner] = (ai.groll[pl.owner] || 0) + 4 + pl.pop / 4;
    ai.zuletztGetroffen = game.turn;
    ai.ruheSeit = game.turn;
  }
  for (const id of jetzt) {
    const vorher = ai.besitz.get(id);
    if (!ai.meine.has(id) && vorher && vorher.owner !== bot.id) ai.ruheSeit = game.turn;
  }
  ai.meine = jetzt;

  const bedroht = new Map();
  for (const f of game.fleets) {
    if (f.owner === bot.id) continue;
    const ziel = f.dest != null ? f.dest : f.at;
    if (ziel == null || !jetzt.has(ziel)) continue;
    const feuer = f.ships.reduce((a, s) => a + s.attack, 0);
    if (feuer <= 0) continue;
    bedroht.set(ziel, (bedroht.get(ziel) || 0) + feuer);
    ai.groll[f.owner] = (ai.groll[f.owner] || 0) + 0.3;
  }
  for (const k of Object.keys(ai.groll)) {
    ai.groll[k] *= 0.97;
    if (ai.groll[k] < 0.2) delete ai.groll[k];
  }

  // Bei den Nachbarn: Besitzwechsel und eingebrochene Bevölkerung - beides
  // heisst, dass dort gerade gekämpft wurde.
  for (const p of enemyWorlds) {
    const alt = ai.besitz.get(p.id);
    if (alt && (alt.owner !== p.owner || p.pop < alt.pop * 0.8)) {
      ai.frisch.set(p.id, game.turn);
      if (alt.owner !== p.owner) ai.ruheSeit = Math.max(ai.ruheSeit, game.turn - 10);
    }
    ai.besitz.set(p.id, { owner: p.owner, pop: p.pop });
  }
  for (const [id, t] of ai.frisch) if (game.turn - t > 6) ai.frisch.delete(id);
  return bedroht;
}

/**
 * Der Rivale: wer nah ist, wer uns zugesetzt hat, wer zu groß wird. Einmal
 * gewählt, bleibt er es eine Weile - sonst wechselt das Reich ständig die
 * Front und sammelt nie genug.
 */
function rivaleWaehlen(ai, P, enemyWorlds, abstand, fuehrer) {
  const punkte = {};
  for (const p of enemyWorlds) {
    const d = abstand.get(p.id);
    if (d < 600) punkte[p.owner] = (punkte[p.owner] || 0) + (600 - d) / 600;
  }
  for (const [o, g] of Object.entries(ai.groll)) punkte[o] = (punkte[o] || 0) + g * P.vergeltung;
  if (fuehrer) punkte[fuehrer] = (punkte[fuehrer] || 0) + 3 * P.gegenFuehrer;
  if (ai.rivale && punkte[ai.rivale] != null) punkte[ai.rivale] += 2;
  let best = null;
  for (const [o, s] of Object.entries(punkte)) if (!best || s > best.s) best = { o, s };
  return best ? best.o : null;
}

/** Bestes Ziel, das die Flotte auch erreichen kann. */
function reachable(game, fleet, arr, score) {
  const sorted = arr.slice().sort((a, b) => score(b) - score(a));
  for (const p of sorted.slice(0, 12)) {
    if (canReach(game, fleet, p).ok) return p;
  }
  return null;
}
