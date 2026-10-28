// The catalogs must match each other: same keys, same placeholders.
// A missing key otherwise only shows up in the game - as an English sentence
// in the middle of German text or, worse, as a bare key.
import { readFileSync } from 'node:fs';
const catalog = (code) => JSON.parse(readFileSync(new URL(`../client/i18n/${code}.json`, import.meta.url), 'utf8'));
const de = catalog('de');
const en = catalog('en');
const uk = catalog('uk');
import { registerLocale, setLocale, t, pluralForms } from '../shared/i18n.js';

const catalogs = { de, en, uk };
let errors = 0;
const fail = (txt) => { console.log('  ' + txt); errors++; };

// 1) Same set of keys. Plural keys (key#form) count once by their base -
//    each language has the forms its own rule needs: one/other in German
//    and English, one/few/many/other in Ukrainian.
const base = (k) => k.split('#')[0];
const bases = (cat) => new Set(Object.keys(cat).map(base));
const all = new Set(Object.values(catalogs).flatMap(cat => [...bases(cat)]));
for (const [name, cat] of Object.entries(catalogs)) {
  const have = bases(cat);
  const missing = [...all].filter(k => !have.has(k));
  if (missing.length) fail(`${name}: ${missing.length} keys missing: ${missing.slice(0, 5).join(', ')}`);
  const plurals = new Set(Object.keys(en).filter(k => k.includes('#')).map(base));
  for (const k of plurals) {
    const lacking = pluralForms(name).filter(f => cat[`${k}#${f}`] == null);
    if (lacking.length && have.has(k)) fail(`${name}: ${k} lacks the plural forms ${lacking.join(', ')}`);
  }
}
console.log(`${all.size} keys, ${Object.keys(catalogs).length} languages.`);

// 2) Same placeholders per key - over all forms of a plural key together
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]);
const index = Object.fromEntries(Object.entries(catalogs).map(([name, cat]) => {
  const m = new Map();
  for (const x of Object.keys(cat)) { const k = base(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return [name, m];
}));
const usedIn = (name, k) => [...new Set((index[name].get(k) || []).flatMap(x => placeholders(catalogs[name][x])))].sort().join(',');
for (const k of all) {
  const ref = usedIn('en', k);
  for (const name of Object.keys(catalogs)) {
    if (!index[name].has(k) || !index.en.has(k)) continue;
    const mine = usedIn(name, k);
    if (mine !== ref) fail(`${k}: placeholders differ (${name}: ${mine || '–'}, en: ${ref || '–'})`);
  }
}

// 3) Every key the server or a tool can name must be translatable - otherwise
//    the bare key shows up in the browser or on the console.
const { readFile } = await import('node:fs/promises');
const sources = ['game.js', 'wormholes.js', 'index.js', 'auth.js', 'userstore.js', 'users.js', 'profile.js'];
let source = '';
for (const name of sources) {
  source += await readFile(new URL('../server/' + name, import.meta.url), 'utf8');
}
// Keys travel as key:, error:, return value or error message.
const KEY = "([a-z]+(?:\\.[A-Za-z]+)+)";
const used = new Set();
for (const pattern of [`key: '${KEY}'`, `error: '${KEY}'`,
                       `return '${KEY}'`, `Error\\('${KEY}'\\)`, `t\\('${KEY}'`]) {
  for (const m of source.matchAll(new RegExp(pattern, 'g'))) used.add(m[1]);
}
// Plural keys are in the catalog as k#one / k#other - both count.
const knows = (cat, k) => cat[k] != null || cat[`${k}#one`] != null || cat[`${k}#other`] != null;
for (const k of used) {
  for (const [name, cat] of Object.entries(catalogs)) {
    if (!knows(cat, k)) fail(`Server sends '${k}', ${name} does not know it.`);
  }
}
console.log(`${used.size} keys come from the server.`);

// 4) Plurals and placeholders work in both languages
registerLocale('de', de); registerLocale('en', en); registerLocale('uk', uk);
for (const [code, expected] of [['de', 'Flotte (1 Schiff) erreicht Sirrah.'],
                                ['en', 'Fleet (1 ship) reaches Sirrah.']]) {
  setLocale(code);
  const got = t('log.arrive', { count: 1, planet: 'Sirrah' });
  if (got !== expected) fail(`${code}: '${got}' instead of '${expected}'`);
}
registerLocale('uk', uk);
setLocale('uk');
for (const n of [1, 2, 5, 21, 22, 25]) {
  const got = t('word.ships', { n, count: n });
  if (!got || got.startsWith('word.')) fail(`uk: no plural for ${n}`);
}

// 5) The UI only names keys that exist - a typo in the markup would otherwise
//    only show up when someone reads the bare key.
const markup = [];
for (const file of ['index.html', 'login.html', 'js/login.js']) {
  markup.push(await readFile(new URL('../client/' + file, import.meta.url), 'utf8'));
}
const fromMarkup = new Set();
for (const m of markup.join('').matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) fromMarkup.add(m[1]);
for (const m of markup.join('').matchAll(/data-i18n-attr="([^"]+)"/g)) {
  for (const pair of m[1].split(';')) fromMarkup.add(pair.split(':')[1]?.trim());
}
for (const m of markup.join('').matchAll(/t\('([a-z]+(?:\.[A-Za-z]+)+)'/g)) fromMarkup.add(m[1]);
for (const k of fromMarkup) {
  if (!k) continue;
  for (const [name, cat] of Object.entries(catalogs)) {
    if (!knows(cat, k)) fail(`The UI names '${k}', ${name} does not know it.`);
  }
}
console.log(`${fromMarkup.size} keys appear in the UI.`);

if (errors) { console.error(`\n${errors} problems in the catalogs.`); process.exit(1); }
console.log('\nCatalogs are complete and match each other.');
