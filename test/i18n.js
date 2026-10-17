// Die Kataloge müssen zueinander passen: gleiche Schlüssel, gleiche Platzhalter.
// Ein fehlender Schlüssel fällt sonst erst im Spiel auf - als englischer Satz
// mitten im deutschen Text oder, schlimmer, als nackter Schlüssel.
import de from '../client/i18n/de.js';
import en from '../client/i18n/en.js';
import { registerLocale, setLocale, t } from '../shared/i18n.js';

const kataloge = { de, en };
let fehler = 0;
const rüge = (txt) => { console.log('  ' + txt); fehler++; };

// 1) Gleiche Schlüsselmenge
const alle = new Set([...Object.keys(de), ...Object.keys(en)]);
for (const [name, kat] of Object.entries(kataloge)) {
  const fehlt = [...alle].filter(k => kat[k] == null);
  if (fehlt.length) rüge(`${name}: ${fehlt.length} Schlüssel fehlen: ${fehlt.slice(0, 5).join(', ')}`);
}
console.log(`${alle.size} Schlüssel, ${Object.keys(kataloge).length} Sprachen.`);

// 2) Gleiche Platzhalter je Schlüssel
const platzhalter = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
for (const k of alle) {
  if (de[k] == null || en[k] == null) continue;
  if (platzhalter(de[k]) !== platzhalter(en[k])) {
    rüge(`${k}: Platzhalter unterschiedlich (de: ${platzhalter(de[k]) || '–'}, en: ${platzhalter(en[k]) || '–'})`);
  }
}

// 3) Jeder Schlüssel, den Server oder Werkzeug nennen kann, muss übersetzbar
//    sein - sonst steht im Browser oder auf der Konsole der nackte Schlüssel.
const { readFile } = await import('node:fs/promises');
const quellen = ['game.js', 'index.js', 'auth.js', 'userstore.js', 'users.js'];
let quelle = '';
for (const name of quellen) {
  quelle += await readFile(new URL('../server/' + name, import.meta.url), 'utf8');
}
// Schlüssel reisen als key:, error:, Rückgabewert oder Fehlermeldung.
const SCHL = "([a-z]+(?:\\.[A-Za-z]+)+)";
const benutzt = new Set();
for (const muster of [`key: '${SCHL}'`, `error: '${SCHL}'`,
                      `return '${SCHL}'`, `Error\\('${SCHL}'\\)`, `t\\('${SCHL}'`]) {
  for (const m of quelle.matchAll(new RegExp(muster, 'g'))) benutzt.add(m[1]);
}
// Mehrzahlschlüssel stehen als k#one / k#other im Katalog - beides gilt.
const kennt = (kat, k) => kat[k] != null || kat[`${k}#one`] != null || kat[`${k}#other`] != null;
for (const k of benutzt) {
  for (const [name, kat] of Object.entries(kataloge)) {
    if (!kennt(kat, k)) rüge(`Server schickt '${k}', ${name} kennt ihn nicht.`);
  }
}
console.log(`${benutzt.size} Schlüssel kommen vom Server.`);

// 4) Mehrzahl und Platzhalter funktionieren in beiden Sprachen
registerLocale('de', de); registerLocale('en', en);
for (const [code, erwartet] of [['de', 'Flotte (1 Schiff) erreicht Sirrah.'],
                                ['en', 'Fleet (1 ship) reaches Sirrah.']]) {
  setLocale(code);
  const got = t('log.arrive', { count: 1, planet: 'Sirrah' });
  if (got !== erwartet) rüge(`${code}: '${got}' statt '${erwartet}'`);
}

// 5) Die Oberflaeche nennt nur Schlüssel, die es gibt - ein Tippfehler im
//    Markup faellt sonst erst auf, wenn jemand den nackten Schlüssel liest.
const markup = [];
for (const datei of ['index.html', 'login.html', 'js/login.js']) {
  markup.push(await readFile(new URL('../client/' + datei, import.meta.url), 'utf8'));
}
const ausMarkup = new Set();
for (const m of markup.join('').matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) ausMarkup.add(m[1]);
for (const m of markup.join('').matchAll(/data-i18n-attr="([^"]+)"/g)) {
  for (const paar of m[1].split(';')) ausMarkup.add(paar.split(':')[1]?.trim());
}
for (const m of markup.join('').matchAll(/t\('([a-z]+(?:\.[A-Za-z]+)+)'/g)) ausMarkup.add(m[1]);
for (const k of ausMarkup) {
  if (!k) continue;
  for (const [name, kat] of Object.entries(kataloge)) {
    if (!kennt(kat, k)) rüge(`Die Oberfläche nennt '${k}', ${name} kennt ihn nicht.`);
  }
}
console.log(`${ausMarkup.size} Schlüssel stehen in der Oberfläche.`);

if (fehler) { console.error(`\n${fehler} Probleme in den Katalogen.`); process.exit(1); }
console.log('\nKataloge sind vollständig und passen zueinander.');
