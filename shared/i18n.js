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
const TAGS = { de: 'de-DE', en: 'en-US' };

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
  const form = params && params.count != null ? plural(params.count) : null;
  // Without count the plural form is used - better than the bare key in case
  // a call forgets the count.
  const candidates = form ? [`${key}#${form}`, key] : [key, `${key}#other`];
  for (const code of [current, FALLBACK]) {
    const cat = catalogs.get(code);
    if (!cat) continue;
    for (const k of candidates) if (cat[k] != null) return cat[k];
  }
  return key;
}

// German and English share the same simple rule. If a language with more
// forms is added, an Intl.PluralRules belongs here.
function plural(n) { return Math.abs(n) === 1 ? 'one' : 'other'; }

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
