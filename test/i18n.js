// The catalogs must match each other: same keys, same placeholders.
// A missing key otherwise only shows up in the game - as an English sentence
// in the middle of German text or, worse, as a bare key.
import { readFileSync } from 'node:fs';
const catalog = (code) => JSON.parse(readFileSync(new URL(`../client/i18n/${code}.json`, import.meta.url), 'utf8'));
const de = catalog('de');
const en = catalog('en');
import { registerLocale, setLocale, t } from '../shared/i18n.js';

const catalogs = { de, en };
let errors = 0;
const fail = (txt) => { console.log('  ' + txt); errors++; };

// 1) Same set of keys
const all = new Set([...Object.keys(de), ...Object.keys(en)]);
for (const [name, cat] of Object.entries(catalogs)) {
  const missing = [...all].filter(k => cat[k] == null);
  if (missing.length) fail(`${name}: ${missing.length} keys missing: ${missing.slice(0, 5).join(', ')}`);
}
console.log(`${all.size} keys, ${Object.keys(catalogs).length} languages.`);

// 2) Same placeholders per key
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
for (const k of all) {
  if (de[k] == null || en[k] == null) continue;
  if (placeholders(de[k]) !== placeholders(en[k])) {
    fail(`${k}: placeholders differ (de: ${placeholders(de[k]) || '–'}, en: ${placeholders(en[k]) || '–'})`);
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
registerLocale('de', de); registerLocale('en', en);
for (const [code, expected] of [['de', 'Flotte (1 Schiff) erreicht Sirrah.'],
                                ['en', 'Fleet (1 ship) reaches Sirrah.']]) {
  setLocale(code);
  const got = t('log.arrive', { count: 1, planet: 'Sirrah' });
  if (got !== expected) fail(`${code}: '${got}' instead of '${expected}'`);
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
