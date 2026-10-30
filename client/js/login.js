// Sign-in, first password change and redeeming an invite link. A separate,
// tiny page - the game client is only served once the session is established.
import {
  initLocale, useLocale, onLocaleChange, applyI18n, localeName, availableLocales, getLocale, localeTag, t
} from './i18n.js';
import { startStars, sceneReady, leaveTo } from './ui/scene.js';
import { enhanceSelects, syncSelects } from './ui/select.js';
import { setupKey, rewrapKey } from './e2e.js';

const $ = s => document.querySelector(s);
const NAME_KEY = 'ho-user';
// The eye in the password fields (revealToggles): open, and crossed out.
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 20 20 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

const loginForm = $('#form-login');
const changeForm = $('#form-change');
const inviteForm = $('#form-invite');
const inviteToken = new URLSearchParams(location.search).get('invite');
// Back here after deleting your own account: say that it worked, once.
const justDeleted = new URLSearchParams(location.search).get('deleted') === '1';
let minPassword = 8;
let invite = null;           // {expires, by, note} of an invite link being redeemed

initLocale();
languagePicker();
enhanceSelects();
revealToggles();
startStars($('#login-canvas'));

/** Language picker as in the start menu, with the same custom select list. */
function languagePicker() {
  const sel = $('#in-lang');
  sel.innerHTML = availableLocales().map(c => `<option value="${c}"></option>`).join('');
  const paint = () => {
    for (const opt of sel.options) opt.textContent = localeName(opt.value);
    sel.value = getLocale();
    // The password change hint carries a number and is not filled from the
    // markup - it has to be set again after every change.
    $('#change-intro').textContent = t('auth.change.intro', { n: minPassword });
    if (invite) paintInvite();
  };
  paint();
  sel.onchange = () => useLocale(sel.value);
  onLocaleChange(() => { paint(); syncSelects(); });
}


/**
 * An eye in every password field: shows what has been typed, and hides it
 * again. Before sending, every field is hidden again - so the password is
 * not left readable on the screen, and the browser's password manager sees
 * a password field as usual.
 */
function revealToggles() {
  const toggles = [];
  for (const input of document.querySelectorAll('input[type=password]')) {
    const wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-eye';
    wrap.appendChild(btn);
    const paint = () => {
      const shown = input.type === 'text';
      btn.innerHTML = shown ? EYE_OFF : EYE;
      btn.setAttribute('aria-pressed', String(shown));
      btn.title = t(shown ? 'auth.hidePassword' : 'auth.showPassword');
      btn.setAttribute('aria-label', btn.title);
    };
    btn.onclick = () => {
      // Keep the cursor where it was - the button must not interrupt typing.
      const { selectionStart: a, selectionEnd: b } = input;
      input.type = input.type === 'password' ? 'text' : 'password';
      paint();
      input.focus();
      try { input.setSelectionRange(a, b); } catch { /* not every browser allows it */ }
    };
    paint();
    toggles.push({ input, paint });
  }
  const hideAll = () => { for (const x of toggles) { x.input.type = 'password'; x.paint(); } };
  for (const form of document.querySelectorAll('form')) form.addEventListener('submit', hideAll, true);
  onLocaleChange(() => { for (const x of toggles) x.paint(); });
}

/**
 * Opens the message key with the password just typed - or makes the first
 * one - and leaves it in this browser (./e2e.js). Never in the way of
 * signing in: if it fails, the friends list asks for the password again.
 */
async function messageKey(handle, password, saved) {
  if (!handle || !globalThis.crypto?.subtle) return;
  try {
    await setupKey(handle, password, saved, async e2e => (await api('key', 'POST', { password, e2e })).e2e);
  } catch (e) {
    console.warn('Message key:', e.message);
  }
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
  $('#login-error').classList.remove('ok');
  $('#login-error').textContent = key ? t(key, params) : '';
}

/** Only targets on this server - otherwise the sign-in becomes a springboard. */
function target() {
  const next = new URLSearchParams(location.search).get('next') || '/';
  // The server names paths from its root; made relative, you stay under a
  // subpath (/ho/) when a proxy sits in front.
  return /^\/($|[^/])/.test(next) ? `.${next}` : './';
}

/** Intro and note of an invite - again after every language change. */
function paintInvite() {
  $('#invite-intro').textContent = t(invite.by ? 'auth.invite.introBy' : 'auth.invite.intro', {
    admin: invite.by,
    n: minPassword,
    time: new Date(invite.expires).toLocaleString(localeTag(), { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  });
  // The admin's own words: as text, never as markup.
  const note = $('#invite-note');
  note.textContent = invite.note || '';
  note.classList.toggle('hidden', !invite.note);
}

function show(which) {
  loginForm.classList.toggle('hidden', which !== 'login');
  changeForm.classList.toggle('hidden', which !== 'change');
  inviteForm.classList.toggle('hidden', which !== 'invite');
  sceneReady();
  const first = which === 'login' ? ($('#in-user').value ? $('#in-pass') : $('#in-user'))
    : which === 'change' ? ($('#in-old').value ? $('#in-new') : $('#in-old'))
    : $('#in-inv-user');
  first.focus();
}

const me = await api('me', 'GET');
if (me.minPassword) minPassword = me.minPassword;
applyI18n();
if (inviteToken) {
  // An invite link wins over an existing session: whoever opens it wants a
  // new account (and the admin may want to try their own link).
  const inv = await api(`invite?token=${encodeURIComponent(inviteToken)}`, 'GET');
  if (inv.ok) {
    invite = { expires: inv.expires, by: inv.by, note: inv.note };
    if (inv.minPassword) minPassword = inv.minPassword;
    paintInvite();
    show('invite');
  } else {
    show('login');
    showError(inv.error || 'auth.err.inviteInvalid', inv.params);
  }
} else if (me.ok && !me.mustChange) {
  // Already signed in? Then move on right away - otherwise going back in the
  // history would leave you in front of the empty form again.
  location.replace(target());
} else {
  try { $('#in-user').value = localStorage.getItem(NAME_KEY) || ''; } catch { /* never mind */ }
  $('#change-intro').textContent = t('auth.change.intro', { n: minPassword });
  show(me.ok ? 'change' : 'login');
  if (justDeleted) {
    showError('auth.del.done');
    $('#login-error').classList.add('ok');
    history.replaceState(null, '', location.pathname);      // not again after a reload
  }
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
    if (!a.mustChange) {
      await messageKey(a.handle, password, a.e2e);
      leaveTo(target());
      return null;
    }
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
    // A key wrapped with the old password goes along rewrapped. After a
    // reset there is none - then the new password makes the first one.
    const current = await api('key', 'GET');
    const e2e = current.e2e && globalThis.crypto?.subtle ? await rewrapKey(current.e2e, password, newPassword) : null;
    const a = await api('change', 'POST', { password, newPassword, e2e });
    if (!a.ok) return { key: a.error || 'auth.err.server', params: a.params };
    await messageKey(a.handle, newPassword, a.e2e);
    leaveTo(target());
    return null;
  });
};

// ---------------------------------------------------------------- Invite link
inviteForm.onsubmit = (e) => {
  e.preventDefault();
  const user = $('#in-inv-user').value.trim();
  const password = $('#in-inv-pass').value;
  if (!user || !password) return showError('auth.err.needFields');
  if (password !== $('#in-inv-pass2').value) return showError('auth.err.mismatch');
  if (password.length < minPassword) return showError('auth.err.tooShort', { n: minPassword });
  submit(inviteForm, async () => {
    const a = await api('redeem', 'POST', { token: inviteToken, user, password });
    if (!a.ok) return { key: a.error || 'auth.err.server', params: a.params };
    try { localStorage.setItem(NAME_KEY, user); } catch { /* never mind */ }
    await messageKey(a.handle, password, a.e2e);
    leaveTo('./');
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
