// Deleting your own account from the start menu (right to erasure). Asked
// twice: first what goes, then once more together with the password - only
// that reaches the server (POST api/auth/delete). Afterwards this browser
// forgets the account and lands on the sign-in page.
import { t } from '../i18n.js';
import { leaveTo } from './scene.js';

const $ = s => document.querySelector(s);

export function openDelete() {
  $('#del-step1').classList.remove('hidden');
  $('#del-form').classList.add('hidden');
  $('#del-error').textContent = '';
  $('#del-pass').value = '';
  $('#acctdel').classList.remove('hidden');
  $('#del-cancel1').focus();
}

function close() {
  $('#acctdel').classList.add('hidden');
  $('#del-pass').value = '';
}

/** @param {() => void} forget drops this browser's game seat (net.forget) */
export function bindDelete(forget) {
  const modal = $('#acctdel');
  if (!modal) return;
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) { e.stopPropagation(); close(); }
  }, true);
  $('#del-cancel1').onclick = close;
  $('#del-cancel2').onclick = close;
  $('#del-next').onclick = () => {
    $('#del-step1').classList.add('hidden');
    $('#del-form').classList.remove('hidden');
    $('#del-pass').focus();
  };
  const error = (key, params) => { $('#del-error').textContent = key ? t(key, params) : ''; };

  $('#del-form').onsubmit = async (e) => {
    e.preventDefault();
    const password = $('#del-pass').value;
    if (!password) return error('auth.del.needPassword');
    const go = $('#del-go');
    go.disabled = true;
    error('');
    try {
      const r = await fetch('api/auth/delete', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }), cache: 'no-store'
      });
      let body = {};
      try { body = await r.json(); } catch { /* an empty response is fine */ }
      if (!r.ok) return error(body.error === 'auth.err.badLogin' ? 'auth.del.wrong' : body.error || 'auth.err.server', body.params);
      $('#del-pass').value = '';
      forget();
      // Nothing of the account stays behind in this browser either.
      try { localStorage.removeItem('ho-user'); } catch { /* storage blocked */ }
      leaveTo('login.html?deleted=1');
    } catch {
      error('auth.err.network');
    } finally {
      go.disabled = false;
    }
  };
}
