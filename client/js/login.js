// Anmeldung und erster Passwortwechsel. Eine eigene, winzige Seite - der
// Spielclient wird erst ausgeliefert, wenn die Sitzung steht.
import {
  initLocale, useLocale, onLocaleChange, anwenden, localeName, availableLocales, getLocale, t
} from './i18n.js';

const $ = s => document.querySelector(s);
const NAME_KEY = 'ho-user';

const anmelden = $('#form-login');
const wechseln = $('#form-change');
let minPassword = 8;

initLocale();
sprachwahl();

/** Sprachwahl wie im Startmenue, nur ohne eigene Auswahlliste. */
function sprachwahl() {
  const sel = $('#in-lang');
  sel.innerHTML = availableLocales().map(c => `<option value="${c}"></option>`).join('');
  const male = () => {
    for (const opt of sel.options) opt.textContent = localeName(opt.value);
    sel.value = getLocale();
    // Der Hinweis zum Passwortwechsel traegt eine Zahl und wird nicht vom
    // Markup gefuellt - er muss nach jedem Wechsel neu gesetzt werden.
    $('#change-intro').textContent = t('auth.change.intro', { n: minPassword });
  };
  male();
  sel.onchange = () => useLocale(sel.value);
  onLocaleChange(male);
}

async function api(route, method, daten) {
  const r = await fetch(`/api/auth/${route}`, {
    method,
    headers: daten ? { 'content-type': 'application/json' } : undefined,
    body: daten ? JSON.stringify(daten) : undefined,
    cache: 'no-store'
  });
  let body = {};
  try { body = await r.json(); } catch { /* leere Antwort ist in Ordnung */ }
  return { ok: r.ok, status: r.status, ...body };
}

function fehler(key, params) {
  $('#login-error').textContent = key ? t(key, params) : '';
}

/** Nur Ziele auf diesem Server - sonst wird die Anmeldung zum Sprungbrett. */
function ziel() {
  const next = new URLSearchParams(location.search).get('next') || '/';
  return /^\/($|[^/])/.test(next) ? next : '/';
}

function zeige(welche) {
  anmelden.classList.toggle('hidden', welche !== 'login');
  wechseln.classList.toggle('hidden', welche !== 'change');
  const erstes = welche === 'login'
    ? ($('#in-user').value ? $('#in-pass') : $('#in-user'))
    : ($('#in-old').value ? $('#in-new') : $('#in-old'));
  erstes.focus();
}

// Schon angemeldet? Dann gleich weiter - sonst stand man nach dem Zurueckgehen
// im Verlauf wieder vor dem leeren Formular.
const me = await api('me', 'GET');
if (me.minPassword) minPassword = me.minPassword;
anwenden();
if (me.ok && !me.mustChange) location.replace(ziel());
else {
  try { $('#in-user').value = localStorage.getItem(NAME_KEY) || ''; } catch { /* egal */ }
  $('#change-intro').textContent = t('auth.change.intro', { n: minPassword });
  zeige(me.ok ? 'change' : 'login');
}

// -------------------------------------------------------------------- Anmelden
anmelden.onsubmit = (e) => {
  e.preventDefault();
  // Wie getippt merken - der Server vergleicht ohne Gross- und Kleinschreibung.
  const user = $('#in-user').value.trim();
  const password = $('#in-pass').value;
  if (!user || !password) return fehler('auth.err.needFields');
  schick(anmelden, async () => {
    const a = await api('login', 'POST', { user, password });
    if (!a.ok) return { key: a.error || 'auth.err.badLogin', params: a.params };
    try { localStorage.setItem(NAME_KEY, user); } catch { /* egal */ }
    if (!a.mustChange) { location.replace(ziel()); return null; }
    // Das erste Passwort gilt nur hier - es gleich eintragen, damit es
    // niemand aus der Mail zweimal abtippen muss.
    $('#in-old').value = password;
    $('#in-pass').value = '';
    zeige('change');
    return null;
  });
};

// ------------------------------------------------------------ Passwortwechsel
wechseln.onsubmit = (e) => {
  e.preventDefault();
  const password = $('#in-old').value;
  const neu = $('#in-new').value;
  if (!password || !neu) return fehler('auth.err.needFields');
  if (neu !== $('#in-new2').value) return fehler('auth.err.mismatch');
  if (neu.length < minPassword) return fehler('auth.err.tooShort', { n: minPassword });
  schick(wechseln, async () => {
    const a = await api('change', 'POST', { password, newPassword: neu });
    if (!a.ok) return { key: a.error || 'auth.err.server', params: a.params };
    location.replace(ziel());
    return null;
  });
};

/**
 * Formular abschicken: Knopf sperren, Fehler anzeigen, Knopf wieder frei.
 * Die Aufgabe gibt null zurueck oder die Beanstandung als {key, params} -
 * der Server schickt etwa zur Sperrfrist die Sekunden mit.
 */
async function schick(form, aufgabe) {
  const knopf = form.querySelector('button');
  const vorher = knopf.textContent;
  knopf.disabled = true;
  knopf.textContent = t('auth.working');
  fehler(null);
  try {
    const rüge = await aufgabe();
    if (rüge) fehler(rüge.key, { n: minPassword, ...rüge.params });
  } catch {
    fehler('auth.err.network');
  } finally {
    knopf.disabled = false;
    knopf.textContent = vorher;
  }
}
