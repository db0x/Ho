// Translation. Tiny and without dependencies so it runs in the browser and in
// Node alike - the server needs it for tests and tools, the UI for everything
// visible.
//
// Ground rule of the project: nothing a human reads lives in the code. The code
// only knows keys ('log.arrive'), the catalogs in client/i18n/ know the
// sentences. That is why the server no longer sends finished sentences either,
// but keys plus values - only the client assembles them in its language.

const catalogs = new Map();
export const FALLBACK = 'en';
let current = FALLBACK;

/** Language tag for numbers and dates - more than the two letters. */
const TAGS = { de: 'de-DE', en: 'en-US', uk: 'uk-UA' };

export function registerLocale(code, messages) {
  catalogs.set(code, { ...(catalogs.get(code) || {}), ...messages });
}

export function setLocale(code) {
  current = catalogs.has(code) ? code : FALLBACK;
  return current;
}

export function getLocale() { return current; }
export function localeTag(code = current) { return TAGS[code] || code; }
export function availableLocales() { return [...catalogs.keys()]; }
export function hasLocale(code) { return catalogs.has(code); }

/**
 * Translates a key. Values are inserted as {name}; if a `count` is among them,
 * the plural form is looked up first (key#one / key#other). If a key is
 * missing, the fallback language is used, and as a last resort the key
 * itself - visible enough to add it later, and never empty.
 */
export function t(key, params) {
  const text = lookup(key, params);
  return interpolate(text, params);
}

/** Does this key exist at all? For cases with optional text. */
export function hasKey(key) {
  return (catalogs.get(current)?.[key] ?? catalogs.get(FALLBACK)?.[key]) != null;
}

function lookup(key, params) {
  // Without count the plural form is used - better than the bare key in case
  // a call forgets the count.
  for (const code of [current, FALLBACK]) {
    const cat = catalogs.get(code);
    if (!cat) continue;
    const form = params && params.count != null ? plural(code, params.count) : null;
    const candidates = form ? [`${key}#${form}`, `${key}#other`, key] : [key, `${key}#other`];
    for (const k of candidates) if (cat[k] != null) return cat[k];
  }
  return key;
}

// Plural forms by the language's own rule: German and English know one and
// other, Ukrainian one, few, many and other (1 корабель, 2 кораблі,
// 5 кораблів, 1,5 корабля).
const pluralRules = new Map();
function plural(code, n) {
  let rules = pluralRules.get(code);
  if (!rules) pluralRules.set(code, rules = new Intl.PluralRules(localeTag(code)));
  return rules.select(Math.abs(n));
}

/** Plural forms a language needs in its catalog (key#form). */
export function pluralForms(code) {
  return new Intl.PluralRules(localeTag(code)).resolvedOptions().pluralCategories;
}

function interpolate(text, params) {
  if (!params || typeof text !== 'string') return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) =>
    params[name] != null ? String(params[name]) : whole);
}

/** Text from a specific language without switching the current one. */
export function tIn(code, key, params) {
  const cat = catalogs.get(code);
  const text = cat?.[key] ?? catalogs.get(FALLBACK)?.[key] ?? key;
  return interpolate(text, params);
}

/** Number in the notation of the current language (no decimals by default). */
export function n(value, digits = 0) {
  return Number(value).toLocaleString(localeTag(), {
    minimumFractionDigits: digits, maximumFractionDigits: digits
  });
}
