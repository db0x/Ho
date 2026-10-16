// Sprachauswahl des Clients. Der Kern liegt in /shared, hier kommen die
// Kataloge dazu und das, was nur der Browser braucht: Sprache des Nutzers
// erkennen, Markup mit data-i18n füllen, Wechsel merken.
import {
  registerLocale, setLocale, getLocale, availableLocales, hasLocale, t, tIn, n, localeTag
} from '/shared/i18n.js';
import de from '/i18n/de.js';
import en from '/i18n/en.js';

registerLocale('de', de);
registerLocale('en', en);

const KEY = 'ho-lang';
const horcher = new Set();

/** Gemerkte Wahl, sonst die Sprache des Browsers, sonst Englisch. */
export function initLocale() {
  let code = null;
  try { code = localStorage.getItem(KEY); } catch {}
  if (!code || !hasLocale(code)) {
    for (const wunsch of navigator.languages || [navigator.language || '']) {
      const kurz = String(wunsch).slice(0, 2).toLowerCase();
      if (hasLocale(kurz)) { code = kurz; break; }
    }
  }
  setLocale(code || 'en');
  anwenden();
  return getLocale();
}

export function useLocale(code) {
  if (code === getLocale()) return;
  setLocale(code);
  try { localStorage.setItem(KEY, code); } catch {}
  anwenden();
  for (const fn of horcher) fn(getLocale());
}

/** Wird nach jedem Sprachwechsel gerufen - die Panels bauen sich dann neu. */
export function onLocaleChange(fn) { horcher.add(fn); }

/**
 * Füllt alles im Markup, was ausgezeichnet ist:
 *   data-i18n="schluessel"       -> Text
 *   data-i18n-html="schluessel"  -> Inhalt mit Auszeichnung (<b>, <i>)
 *   data-i18n-attr="title:k;placeholder:k"
 * Werte dürfen mitkommen: data-i18n-args='{"n":5}'.
 */
export function anwenden(wurzel = document) {
  document.documentElement.lang = getLocale();
  for (const el of wurzel.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n, args(el));
  }
  for (const el of wurzel.querySelectorAll('[data-i18n-html]')) {
    el.innerHTML = t(el.dataset.i18nHtml, args(el));
  }
  for (const el of wurzel.querySelectorAll('[data-i18n-attr]')) {
    for (const paar of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = paar.split(':').map(x => x.trim());
      if (attr && key) el.setAttribute(attr, t(key, args(el)));
    }
  }
  const titel = document.querySelector('title');
  if (titel) titel.textContent = t('app.title');
}

function args(el) {
  if (!el.dataset.i18nArgs) return undefined;
  try { return JSON.parse(el.dataset.i18nArgs); } catch { return undefined; }
}

/** Wie eine Sprache sich selbst nennt - steht in ihrem eigenen Katalog. */
export function localeName(code) { return tIn(code, 'lang.name'); }

export { t, n, getLocale, availableLocales, localeTag };
