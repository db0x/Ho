// Language selection of the client. The core lives in /shared; this adds the
// catalogs and what only the browser needs: detecting the user's language,
// filling markup with data-i18n, remembering the choice.
import {
  registerLocale, setLocale, getLocale, availableLocales, hasLocale, hasKey, t, tIn, n, localeTag
} from '../shared/i18n.js';

// The catalogs live as JSON under /i18n/<code>.json: keys are named by area
// (menu., lobby., log. ...), {values} get inserted, keys with #one / #other
// (Ukrainian also #few / #many) are the plural forms. They load before anything else - whoever imports
// this module waits until both are there.
const LANGUAGES = ['de', 'en', 'uk'];
const catalogs = await Promise.all(LANGUAGES.map(code =>
  fetch(`i18n/${code}.json`).then(r => {
    if (!r.ok) throw new Error(`Catalog ${code}: HTTP ${r.status}`);
    return r.json();
  })));
LANGUAGES.forEach((code, i) => registerLocale(code, catalogs[i]));

const KEY = 'ho-lang';
const listeners = new Set();

/** The remembered choice, otherwise the browser's language, otherwise English. */
export function initLocale() {
  let code = null;
  try { code = localStorage.getItem(KEY); } catch {}
  if (!code || !hasLocale(code)) {
    for (const wanted of navigator.languages || [navigator.language || '']) {
      const short = String(wanted).slice(0, 2).toLowerCase();
      if (hasLocale(short)) { code = short; break; }
    }
  }
  setLocale(code || 'en');
  applyI18n();
  return getLocale();
}

export function useLocale(code) {
  if (code === getLocale()) return;
  setLocale(code);
  try { localStorage.setItem(KEY, code); } catch {}
  applyI18n();
  for (const fn of listeners) fn(getLocale());
}

/** Called after every language change - the panels then rebuild themselves. */
export function onLocaleChange(fn) { listeners.add(fn); }

/**
 * Fills everything in the markup that is marked up:
 *   data-i18n="key"              -> text
 *   data-i18n-html="key"         -> content with markup (<b>, <i>)
 *   data-i18n-attr="title:k;placeholder:k"
 * Values may come along: data-i18n-args='{"n":5}'.
 */
export function applyI18n(root = document) {
  document.documentElement.lang = getLocale();
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n, args(el));
  }
  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    el.innerHTML = t(el.dataset.i18nHtml, args(el));
  }
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map(x => x.trim());
      if (attr && key) el.setAttribute(attr, t(key, args(el)));
    }
  }
  const title = document.querySelector('title');
  if (title) title.textContent = t('app.title');
}

function args(el) {
  if (!el.dataset.i18nArgs) return undefined;
  try { return JSON.parse(el.dataset.i18nArgs); } catch { return undefined; }
}

/** "5 minutes ago" in the chosen language, with the largest fitting unit. */
export function relative(deltaMs) {
  const rtf = new Intl.RelativeTimeFormat(localeTag(), { numeric: 'auto', style: 'short' });
  const s = Math.round(deltaMs / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  // Hours up to two days: "in 23 hours" says more than "tomorrow".
  if (abs < 2 * 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}

/** What a language calls itself - stored in its own catalog. */
export function localeName(code) { return tIn(code, 'lang.name'); }

export { t, n, hasKey, getLocale, availableLocales, localeTag };
