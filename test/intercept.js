// Abfangen: wer aus einem Orbit abfliegt, in dem ein bewaffneter Gegner
// steht, kaempft INTERCEPT_ROUNDS Runden mit und ist dann fort. Vorher
// entkam jeder Spaeher, weil Bewegung vor dem Kampf abgerechnet wird.
import { createGame, addPlayer, startGame, resolveTurn } from '../server/game.js';
import { shipStats, INTERCEPT_ROUNDS } from '../shared/rules.js';

let fehler = 0;
const assert = (ok, msg) => { if (!ok) { console.error('FEHLER: ' + msg); fehler++; } };

/** Zwei Reiche, eine freie Welt nahe der eigenen Heimat, zwei leere Flotten. */
function aufbau() {
  const g = createGame('Abfangen');
  g.settings.seed = 42;
  g.settings.turnTimer = 0;
  addPlayer(g, { name: 'Ich' });
  addPlayer(g, { name: 'Feind' });
  startGame(g);
  const [me, foe] = g.players;
  const home = g.galaxy.planets.find(p => p.id === me.homeworld);
  const P = g.galaxy.planets.filter(p => p.owner === null)
    .sort((a, b) => Math.hypot(a.x - home.x, a.y - home.y) - Math.hypot(b.x - home.x, b.y - home.y))[0];
  // Ein vorhandenes Schiff als Vorlage: Technikstand und Felder stimmen dann.
  const vorlage = (owner) => g.fleets.find(f => f.owner === owner).ships[0];
  const flotte = (owner, type, n) => {
    const muster = vorlage(owner);
    const st = shipStats(type, muster.tech);
    const ships = Array.from({ length: n }, () => ({
      ...muster, id: 's' + g.nextShipId++, type, hp: st.maxHp, maxHp: st.maxHp,
      attack: st.attack, speed: Math.round(st.speed), range: Math.round(st.range), colonists: 0
    }));
    const f = { id: 'f' + g.nextFleetId++, owner, ships, at: P.id, x: P.x, y: P.y, z: P.z || 0, dest: null };
    g.fleets.push(f);
    return f;
  };
  // Der Jaeger kommt diesen Zug an: knapp neben der Welt, Kurs auf sie
  const anflug = (f) => Object.assign(f, { at: null, x: P.x + 5, dest: P.id });
  return { g, me, foe, P, flotte, anflug };
}

const kampfBei = (entries, P) => entries.find(e => e.type === 'combat' && e.planetId === P.id && e.battle);

// 1) Ein einzelner Spaeher flieht vor einem ankommenden Jaeger - und wird erwischt
{
  const { g, me, foe, P, flotte, anflug } = aufbau();
  anflug(flotte(me.id, 'fighter', 1));
  const spaeher = flotte(foe.id, 'scout', 1);
  spaeher.dest = foe.homeworld;
  const entries = resolveTurn(g);
  const k = kampfBei(entries, P);
  assert(k, 'Fliehender Späher wurde nicht abgefangen');
  assert(!g.fleets.includes(spaeher) || !spaeher.ships.length, 'Späher hat das Abfangen überlebt');
  assert(k?.battle.fled.length === 1, 'Mitschrift nennt den Fliehenden nicht');
}

// 2) Eine starke Flotte flieht vor einem Jaeger: sie kaempft nur die ersten
//    Runden mit und ist danach fort, nicht im Orbit festgehalten.
{
  const { g, me, foe, P, flotte, anflug } = aufbau();
  anflug(flotte(me.id, 'fighter', 1));
  const stark = flotte(foe.id, 'fighter', 6);
  stark.dest = foe.homeworld;
  const entries = resolveTurn(g);
  const k = kampfBei(entries, P);
  assert(k, 'Fliehende Flotte wurde nicht abgefangen');
  assert(stark.ships.length > 0 && stark.at !== P.id, 'Starke Flotte ist nicht entkommen');
  const fled = new Set(k.battle.fled);
  k.battle.rounds.forEach((shots, r) => {
    if (r < INTERCEPT_ROUNDS) return;
    for (const [from, to] of shots) {
      assert(!fled.has(from) && !fled.has(to), `Fliehender kämpft noch in Runde ${r + 1}`);
    }
  });
}

// 3) Ohne bewaffneten Gegner fliegt man unbehelligt ab
{
  const { g, me, foe, P, flotte } = aufbau();
  flotte(me.id, 'scout', 1).dest = me.homeworld;
  const spaeher = flotte(foe.id, 'scout', 1);
  spaeher.dest = foe.homeworld;
  const entries = resolveTurn(g);
  assert(!kampfBei(entries, P), 'Kampf ohne Bewaffnete');
  assert(spaeher.ships.length === 1, 'Späher ohne Grund verloren');
}

// 4) Wer nur ankommt und bleibt, kaempft wie bisher die volle Schlacht
{
  const { g, me, foe, P, flotte, anflug } = aufbau();
  anflug(flotte(me.id, 'fighter', 1));
  flotte(foe.id, 'scout', 1);
  const k = kampfBei(resolveTurn(g), P);
  assert(k && k.battle.fled.length === 0, 'Bleibender Späher als Flüchtling geführt');
}

if (fehler) process.exit(1);
console.log('Alle Prüfungen zum Abfangen bestanden.');
