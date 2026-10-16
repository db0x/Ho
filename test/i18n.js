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

// 3) Jeder Schlüssel, den der Server schicken kann, muss übersetzbar sein
const quelle = await (await import('node:fs/promises')).readFile(
  new URL('../server/game.js', import.meta.url), 'utf8');
const quelle2 = await (await import('node:fs/promises')).readFile(
  new URL('../server/index.js', import.meta.url), 'utf8');
const benutzt = new Set();
for (const m of (quelle + quelle2).matchAll(/key: '([a-z]+\.[A-Za-z]+)'/g)) benutzt.add(m[1]);
for (const m of (quelle + quelle2).matchAll(/error: '([a-z]+\.[A-Za-z]+)'/g)) benutzt.add(m[1]);
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

if (fehler) { console.error(`\n${fehler} Probleme in den Katalogen.`); process.exit(1); }
console.log('\nKataloge sind vollständig und passen zueinander.');
