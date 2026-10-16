// Übersetzung. Winzig und ohne Abhängigkeit, damit sie im Browser und in Node
// gleichermaßen läuft - der Server braucht sie für Tests und Werkzeuge, die
// Oberfläche für alles Sichtbare.
//
// Grundregel im Projekt: Nichts, was ein Mensch liest, steht im Code. Der Code
// kennt nur Schlüssel ('log.arrive'), die Kataloge in client/i18n/ kennen die
// Sätze. Der Server schickt deshalb auch keine fertigen Sätze mehr, sondern
// Schlüssel samt Werten - erst der Client setzt sie in seiner Sprache zusammen.

const kataloge = new Map();
export const FALLBACK = 'en';
let aktuell = FALLBACK;

/** Sprachtag für Zahlen und Daten - mehr als die zwei Buchstaben. */
const TAGS = { de: 'de-DE', en: 'en-US' };

export function registerLocale(code, messages) {
  kataloge.set(code, { ...(kataloge.get(code) || {}), ...messages });
}

export function setLocale(code) {
  aktuell = kataloge.has(code) ? code : FALLBACK;
  return aktuell;
}

export function getLocale() { return aktuell; }
export function localeTag(code = aktuell) { return TAGS[code] || code; }
export function availableLocales() { return [...kataloge.keys()]; }
export function hasLocale(code) { return kataloge.has(code); }

/**
 * Übersetzt einen Schlüssel. Werte werden als {name} eingesetzt; steckt ein
 * `count` darin, wird vorher die Mehrzahlform gesucht (schluessel#one /
 * schluessel#other). Fehlt ein Schlüssel, kommt die Ersatzsprache, und zur Not
 * der Schlüssel selbst - sichtbar genug, um ihn nachzutragen, und nie leer.
 */
export function t(key, params) {
  const satz = suchen(key, params);
  return einsetzen(satz, params);
}

/** Gibt es diesen Schlüssel überhaupt? Für Fälle mit optionalem Text. */
export function hasKey(key) {
  return (kataloge.get(aktuell)?.[key] ?? kataloge.get(FALLBACK)?.[key]) != null;
}

function suchen(key, params) {
  const form = params && params.count != null ? plural(params.count) : null;
  // Ohne count wird die Mehrzahlform genommen - besser als der nackte
  // Schluessel, falls ein Aufruf das count vergisst.
  const stellen = form ? [`${key}#${form}`, key] : [key, `${key}#other`];
  for (const code of [aktuell, FALLBACK]) {
    const kat = kataloge.get(code);
    if (!kat) continue;
    for (const k of stellen) if (kat[k] != null) return kat[k];
  }
  return key;
}

// Deutsch und Englisch teilen sich dieselbe einfache Regel. Käme eine Sprache
// mit mehr Formen dazu, gehört hier ein Intl.PluralRules hin.
function plural(n) { return Math.abs(n) === 1 ? 'one' : 'other'; }

function einsetzen(satz, params) {
  if (!params || typeof satz !== 'string') return satz;
  return satz.replace(/\{(\w+)\}/g, (ganz, name) =>
    params[name] != null ? String(params[name]) : ganz);
}

/** Text aus einer bestimmten Sprache, ohne die aktuelle zu wechseln. */
export function tIn(code, key, params) {
  const kat = kataloge.get(code);
  const satz = kat?.[key] ?? kataloge.get(FALLBACK)?.[key] ?? key;
  return einsetzen(satz, params);
}

/** Zahl in der Schreibweise der aktuellen Sprache (ohne Nachkommastelle). */
export function n(wert, stellen = 0) {
  return Number(wert).toLocaleString(localeTag(), {
    minimumFractionDigits: stellen, maximumFractionDigits: stellen
  });
}
