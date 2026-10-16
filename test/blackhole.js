// Das schwarze Loch als Spielelement: In einer Spiralgalaxie darf keine Flotte
// durch die Sperrzone fliegen oder darin stehen bleiben - auch nicht zwischen
// zwei Runden, wenn sie nur daran vorbeizieht.
import { createGame, addPlayer, startGame, resolveTurn } from '../server/game.js';
import { runBot } from '../server/bot.js';
import { holeZone, route, routeLength, blocked, dist, travelDistance, reachOutline } from '../shared/rules.js';

const game = createGame('Loch');
game.settings.seed = 20251015;
game.settings.turnTimer = 0;
game.settings.shape = 'spiral';
for (let i = 0; i < 12; i++) addPlayer(game, { isBot: true, name: 'KI ' + (i + 1) });
const r = startGame(game);
if (r.error) throw new Error(r.error);

const zone = holeZone(game.galaxy);
if (!zone) throw new Error('Spiralgalaxie ohne schwarzes Loch');
console.log(`Galaxie: ${game.galaxy.planets.length} Welten, Loch "${game.galaxy.blackHole.name}" `
  + `mit Sperrzone ${Math.round(zone.r)} Lj`);

// Keine Welt darf in der Zone liegen - sonst waere ein Ziel unerreichbar.
const abstand = (liste) => liste.reduce(
  (b, p) => Math.min(b, dist(p, zone) - zone.r), Infinity);
for (const p of game.galaxy.planets) {
  if (dist(p, zone) < zone.r) throw new Error(`Welt ${p.name} liegt in der Sperrzone`);
}
console.log(`Naechste Welt liegt ${abstand(game.galaxy.planets).toFixed(0)} Lj vor der Grenze.`);

let fehler = 0, umwege = 0, engste = Infinity;
const TURNS = 100;

for (let t = 0; t < TURNS && game.state === 'running'; t++) {
  for (const b of game.players.filter(p => p.isBot && p.alive)) runBot(game, b);
  resolveTurn(game);

  for (const f of game.fleets) {
    const d = dist(f, zone);
    engste = Math.min(engste, d);
    if (d < zone.r - 1e-6) {
      console.log(`Flotte ${f.id} steht in der Sperrzone (${d.toFixed(1)} < ${zone.r})`);
      fehler++;
    }
    if (f.dest != null) {
      const ziel = game.galaxy.planets.find(p => p.id === f.dest);
      if (!ziel) continue;
      // Luftlinie gesperrt heisst: der Kurs muss aussen herum gehen.
      if (blocked(f, ziel, zone)) umwege++;
      // Und jedes Stueck des geplanten Wegs muss draussen bleiben.
      let prev = f;
      for (const w of route(f, ziel, zone)) {
        if (blocked(prev, w, zone)) {
          console.log(`Kurs von Flotte ${f.id} schneidet die Sperrzone`);
          fehler++;
          break;
        }
        prev = w;
      }
    }
  }
  // Keine Welt in der Zone, auch nicht nach dem Wachsen der Galaxie
  for (const p of game.galaxy.planets) {
    if (dist(p, zone) < zone.r) { console.log(`Neue Welt ${p.name} in der Sperrzone`); fehler++; }
  }
}

console.log(`${TURNS} Runden gespielt, engster Vorbeiflug: ${engste.toFixed(1)} Lj `
  + `(Grenze ${zone.r.toFixed(1)}), ${umwege} Kurse am Loch vorbeigeführt.`);

// Der gezeichnete Reichweiten-Umriss muss zur Entscheidung des Servers passen:
// was drinliegt, ist fliegbar - was knapp draussen liegt, nicht.
{
  const basis = game.galaxy.planets.find(p => p.owner) || game.galaxy.planets[0];
  const range = 400;
  const umriss = reachOutline(basis, range, zone);
  let drin = 0, drueber = 0;
  for (const q of umriss) {
    const d = travelDistance(basis, q, zone);
    if (d > range + 1) { drueber++; continue; }
    drin++;
    // Ein Stueck weiter aussen muss es kippen, sonst ist der Umriss zu eng.
    const dx = q.x - basis.x, dy = q.y - basis.y;
    const laenge = Math.hypot(dx, dy) || 1;
    const weiter = { x: basis.x + dx / laenge * (laenge + 6), y: basis.y + dy / laenge * (laenge + 6), z: q.z };
    if (travelDistance(basis, weiter, zone) <= range) {
      console.log(`Umriss zu eng: ${Math.round(travelDistance(basis, weiter, zone))} <= ${range}`);
      fehler++;
      break;
    }
  }
  if (drueber) { console.log(`${drueber} Umrisspunkte liegen ausserhalb der Reichweite`); fehler++; }
  console.log(`Reichweiten-Umriss: ${drin} Punkte, alle fliegbar und am Rand.`);
}

// Und der Umweg muss auch wirklich laenger sein als die Luftlinie.
const a = { x: zone.x - 600, y: zone.y, z: 0 };
const b = { x: zone.x + 600, y: zone.y, z: 0 };
const umweg = routeLength(a, route(a, b, zone));
if (!(umweg > dist(a, b))) { console.log('Umweg ist nicht laenger als die Gerade'); fehler++; }
console.log(`Quer durch das Loch: ${Math.round(umweg)} statt ${Math.round(dist(a, b))} Lj.`);

if (fehler) { console.error(`\n${fehler} Verstoesse gegen die Sperrzone.`); process.exit(1); }
console.log('\nAlle Prüfungen zum schwarzen Loch bestanden.');
