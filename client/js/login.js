// Sign-in and first password change. A separate, tiny page - the game client
// is only served once the session is established.
import {
  initLocale, useLocale, onLocaleChange, applyI18n, localeName, availableLocales, getLocale, t
} from './i18n.js';

const $ = s => document.querySelector(s);
const NAME_KEY = 'ho-user';

const loginForm = $('#form-login');
const changeForm = $('#form-change');
let minPassword = 8;

initLocale();
languagePicker();

/** Language picker as in the start menu, just without its own select list. */
function languagePicker() {
  const sel = $('#in-lang');
  sel.innerHTML = availableLocales().map(c => `<option value="${c}"></option>`).join('');
  const paint = () => {
    for (const opt of sel.options) opt.textContent = localeName(opt.value);
    sel.value = getLocale();
    // The password change hint carries a number and is not filled from the
    // markup - it has to be set again after every change.
    $('#change-intro').textContent = t('auth.change.intro', { n: minPassword });
  };
  paint();
  sel.onchange = () => useLocale(sel.value);
  onLocaleChange(paint);
}

async function api(route, method, data) {
  const r = await fetch(`api/auth/${route}`, {
    method,
    headers: data ? { 'content-type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
    cache: 'no-store'
  });
  let body = {};
  try { body = await r.json(); } catch { /* an empty response is fine */ }
  return { ok: r.ok, status: r.status, ...body };
}

function showError(key, params) {
  $('#login-error').textContent = key ? t(key, params) : '';
}

/** Only targets on this server - otherwise the sign-in becomes a springboard. */
function target() {
  const next = new URLSearchParams(location.search).get('next') || '/';
  // The server names paths from its root; made relative, you stay under a
  // subpath (/ho/) when a proxy sits in front.
  return /^\/($|[^/])/.test(next) ? `.${next}` : './';
}

function show(which) {
  loginForm.classList.toggle('hidden', which !== 'login');
  changeForm.classList.toggle('hidden', which !== 'change');
  const first = which === 'login'
    ? ($('#in-user').value ? $('#in-pass') : $('#in-user'))
    : ($('#in-old').value ? $('#in-new') : $('#in-old'));
  first.focus();
}

// Already signed in? Then move on right away - otherwise going back in the
// history would leave you in front of the empty form again.
const me = await api('me', 'GET');
if (me.minPassword) minPassword = me.minPassword;
applyI18n();
if (me.ok && !me.mustChange) location.replace(target());
else {
  try { $('#in-user').value = localStorage.getItem(NAME_KEY) || ''; } catch { /* never mind */ }
  $('#change-intro').textContent = t('auth.change.intro', { n: minPassword });
  show(me.ok ? 'change' : 'login');
}

// --------------------------------------------------------------------- Sign in
loginForm.onsubmit = (e) => {
  e.preventDefault();
  // Remember it as typed - the server compares case-insensitively.
  const user = $('#in-user').value.trim();
  const password = $('#in-pass').value;
  if (!user || !password) return showError('auth.err.needFields');
  submit(loginForm, async () => {
    const a = await api('login', 'POST', { user, password });
    if (!a.ok) return { key: a.error || 'auth.err.badLogin', params: a.params };
    try { localStorage.setItem(NAME_KEY, user); } catch { /* never mind */ }
    if (!a.mustChange) { location.replace(target()); return null; }
    // The first password is only valid here - fill it in right away so nobody
    // has to type it from the mail twice.
    $('#in-old').value = password;
    $('#in-pass').value = '';
    show('change');
    return null;
  });
};

// ------------------------------------------------------------- Password change
changeForm.onsubmit = (e) => {
  e.preventDefault();
  const password = $('#in-old').value;
  const newPassword = $('#in-new').value;
  if (!password || !newPassword) return showError('auth.err.needFields');
  if (newPassword !== $('#in-new2').value) return showError('auth.err.mismatch');
  if (newPassword.length < minPassword) return showError('auth.err.tooShort', { n: minPassword });
  submit(changeForm, async () => {
    const a = await api('change', 'POST', { password, newPassword });
    if (!a.ok) return { key: a.error || 'auth.err.server', params: a.params };
    location.replace(target());
    return null;
  });
};

/**
 * Submit a form: lock the button, show errors, unlock the button again.
 * The task returns null or the complaint as {key, params} - for a lockout,
 * for example, the server sends the seconds along.
 */
async function submit(form, task) {
  const button = form.querySelector('button');
  const before = button.textContent;
  button.disabled = true;
  button.textContent = t('auth.working');
  showError(null);
  try {
    const problem = await task();
    if (problem) showError(problem.key, { n: minPassword, ...problem.params });
  } catch {
    showError('auth.err.network');
  } finally {
    button.disabled = false;
    button.textContent = before;
  }
}
