// Changing your own password from the start menu. The server already knows
// how (POST api/auth/change, the same route as the first password change on
// the sign-in page): it asks for the current password again, ends every
// session of the account and hands this browser a fresh one right away.
import { t } from '../i18n.js';

const $ = s => document.querySelector(s);
let minPassword = 8;

/** @param {number} [min] minimum length as the server reports it */
export function openPassword(min) {
  if (min) minPassword = min;
  const modal = $('#pwchange');
  $('#pw-form').classList.remove('hidden');
  $('#pw-done').classList.add('hidden');
  $('#pw-intro').textContent = t('auth.pw.intro', { n: minPassword });
  $('#pw-error').textContent = '';
  for (const id of ['#pw-old', '#pw-new', '#pw-new2']) $(id).value = '';
  modal.classList.remove('hidden');
  $('#pw-old').focus();
}

function close() {
  $('#pwchange').classList.add('hidden');
  for (const id of ['#pw-old', '#pw-new', '#pw-new2']) $(id).value = '';
}

export function bindPassword() {
  const modal = $('#pwchange');
  if (!modal) return;
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) { e.stopPropagation(); close(); }
  }, true);
  $('#pw-cancel').onclick = close;
  $('#pw-ok').onclick = close;
  const error = (key, params) => { $('#pw-error').textContent = key ? t(key, params) : ''; };

  $('#pw-form').onsubmit = async (e) => {
    e.preventDefault();
    const password = $('#pw-old').value;
    const newPassword = $('#pw-new').value;
    if (!password || !newPassword) return error('auth.pw.needFields');
    if (newPassword !== $('#pw-new2').value) return error('auth.err.mismatch');
    if (newPassword.length < minPassword) return error('auth.err.tooShort', { n: minPassword });
    const save = $('#pw-save');
    save.disabled = true;
    error('');
    try {
      const r = await fetch('api/auth/change', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password, newPassword }), cache: 'no-store'
      });
      let body = {};
      try { body = await r.json(); } catch { /* an empty response is fine */ }
      // The server's "name or password wrong" is meant for the sign-in - here
      // only the current password can be wrong.
      if (!r.ok) return error(body.error === 'auth.err.badLogin' ? 'auth.pw.wrongCurrent' : body.error || 'auth.err.server', body.params);
      for (const id of ['#pw-old', '#pw-new', '#pw-new2']) $(id).value = '';
      $('#pw-form').classList.add('hidden');
      $('#pw-done').classList.remove('hidden');
      $('#pw-ok').focus();
    } catch {
      error('auth.err.network');
    } finally {
      save.disabled = false;
    }
  };
}
