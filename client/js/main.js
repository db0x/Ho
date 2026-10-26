// Entry point: wires up network, lobby, map and UI.
import { Net } from './net.js';
import { Lobby } from './ui/lobby.js';
import { Hud } from './ui/hud.js';
import { openShipInfo } from './ui/shipinfo.js';
import { AdminPanel } from './ui/admin.js';
import { sceneReady, leaveTo } from './ui/scene.js';
import { showAnnouncement } from './ui/announce.js';
import { openNews, hasNews, newsOnHello } from './ui/news.js';
import { bindEmoji } from './ui/emoji.js';
import { emojify } from '../shared/emoji.js';
import { releaseOf } from '../shared/version.js';
import { openPassword, bindPassword } from './ui/password.js';
import { openGameEnd, bindGameEnd } from './ui/gameend.js';
import { openBattle } from './ui/battle.js';
import { MapView } from './render/map.js';
import { SpaceView } from './render/space.js';
import { sfx, bindUi, LOG_SFX } from './audio/sfx.js';
import { Voice } from './voice.js';
import { enhanceSelects, syncSelects } from './ui/select.js';
import { compact } from './ui/viewport.js';
import { initLocale, useLocale, onLocaleChange, localeName, t, availableLocales, getLocale } from './i18n.js';

const $ = s => document.querySelector(s);
// Too narrow or too low for docks side by side: then the sheet bar applies.
// The decision is based on space, not on the kind of pointer - a split window
// on a computer has the same problem as a phone.
const narrow = compact;

// Language first: markup and panels are then already built translated.
initLocale();
languagePicker();
bindUi();
// Safari on iPad and iPhone ignores user-scalable: a pinch on a panel would
// zoom the whole page. The map handles two fingers itself (pointer events).
addEventListener('gesturestart', (e) => e.preventDefault());
enhanceSelects();
// Texts and select lists are in place: let the start menu float in.
sceneReady();

/**
 * Select fields for the language, in the start menu and in the game (gear at
 * the bottom right). A change stores the choice, translates the markup again
 * and lets the panels rebuild themselves - without reloading, so a running
 * game continues.
 */
function languagePicker() {
  // Start menu and in-game map settings - both show the same choice.
  const fields = ['#in-lang', '#in-lang-game'].map(s => document.querySelector(s)).filter(Boolean);
  if (!fields.length) return;
  // Build once; later only refresh the texts so the custom select list
  // (select.js) does not have to be rebuilt.
  for (const sel of fields) {
    sel.innerHTML = availableLocales()
      .map(code => `<option value="${code}"></option>`).join('');
    sel.onchange = () => useLocale(sel.value);
  }
  const paint = () => {
    for (const sel of fields) {
      for (const opt of sel.options) opt.textContent = localeName(opt.value);
      sel.value = getLocale();
    }
  };
  paint();
  onLocaleChange(() => {
    paint();
    syncSelects();                 // button labels of the custom lists
    lobby?.relabel();
    // The language change rewrites the tabs from the markup - but when
    // spectating, the first one is called "Empires", not "Research".
    hud?.chrome();
    if (hud?.view) hud.update(hud.view);
  });
}

/**
 * Account and sign-out below the language picker. If the server runs without
 * sign-in (HO_AUTH=off), /api/auth/me answers with 404 and the row stays hidden.
 */
async function account() {
  const row = document.querySelector('#account-row');
  const name = document.querySelector('#account-name');
  if (!row) return;
  let who = null, me = null;
  try {
    const r = await fetch('api/auth/me', { cache: 'no-store' });
    if (!r.ok) return;
    me = await r.json();
    who = me.display || me.user;
  } catch { return; }
  if (!who) return;
  // The display name is set by the profile (net 'hello'); it may differ from
  // the account name. This only says which account you are signed in with.
  const paint = () => {
    name.textContent = t('auth.signedInAs', { user: who });
  };
  paint();
  onLocaleChange(paint);
  row.classList.remove('hidden');
  bindPassword();
  document.querySelector('#pw-user').value = me.user;
  document.querySelector('#link-password').onclick = (e) => {
    e.preventDefault();
    openPassword(me.minPassword);
  };
  document.querySelector('#link-logout').onclick = async (e) => {
    e.preventDefault();
    net.forget();
    try { await fetch('api/auth/logout', { method: 'POST' }); } catch { /* never mind */ }
    leaveTo('login.html');
  };
}

const net = new Net();
const lobby = new Lobby(net);
const voice = new Voice({ send: m => net.send(m) });
const admin = new AdminPanel(net);
account();
let map = null;
let hud = null;
// From the manual: in the game with your own tech levels, otherwise with the starting level.
document.querySelector('#help-ships').onclick = () => {
  if (hud) hud.showShip('scout');
  else openShipInfo('scout');
};
let lastTurn = 0;

const app = {
  selection: null,
  spectator: false,
  // Battle records per "turn:world". The server only sends them along for the
  // latest turn, so they are collected here.
  battles: new Map(),
  openBattle(key) {
    const b = app.battles.get(key);
    const v = map?.view;
    if (!b || !v) return;
    openBattle({ battle: b.battle, planet: v.planets[b.planetId], players: v.players, you: v.you });
  },
  send: (m) => net.send(m),
  setSelection(sel) {
    app.selection = sel;
    if (map) map.selection = sel;
    if (hud) hud.selection();
    // On a phone the panel is not visible alongside: tapped means opened -
    // at half height, so the map stays big enough to play on - and tapping
    // empty map means closed. The selection moves into the part of the map
    // that the sheet leaves free.
    if (narrow.matches) {
      app.showSheet?.(sel ? 'right' : '', 'peek');
      app.refocus();
    }
  },
  /** Moves the selection into the part of the map that no sheet covers. */
  refocus() {
    const sel = app.selection;
    if (!sel || !map) return;
    const target = sel.type === 'planet' ? map.view?.planets[sel.id]
      : map.view?.fleets.find(f => f.id === sel.id);
    if (target) map.focus(target, app.freeArea());
  },
  order(planetId) {
    if (app.spectator) return;
    const sel = app.selection;
    const fleetId = sel?.type === 'fleet' ? sel.id : hud?.lastFleetId;
    // Only order a fleet that really exists in this view and belongs to us -
    // otherwise the server swallows the order and it looks as if the button
    // did not register.
    const fleet = map?.view?.fleets.find(f => f.id === fleetId);
    if (!fleetId || !fleet || !fleet.mine) {
      hud?.toast(t('fleet.selectFirst')); sfx.play('deny'); return;
    }
    net.send({ t: 'orders', move: { fleetId, planetId } });
    sfx.play('course', { pan: panOf(planetId) });
  },
  get map() { return map; },
  /**
   * The part of the map that no sheet currently covers. In portrait the sheet
   * sits at the bottom, in landscape at the side - both come out here as a
   * free rectangle so the selection lands in the visible part.
   */
  freeArea() {
    const area = { w: map ? map.w : innerWidth, h: map ? map.h : innerHeight };
    if (!narrow.matches) return area;
    const open = document.querySelector('#screen-game[data-sheet]:not([data-sheet=""])');
    if (!open) return area;
    const sheet = [...open.querySelectorAll('#leftdock, #rightdock, #logdock')]
      .find(e => getComputedStyle(e).display !== 'none');
    if (!sheet) return area;
    const r = sheet.getBoundingClientRect();
    // If it takes the full width, it sits at the bottom; otherwise at the side.
    if (r.width > area.w * 0.9) area.h = Math.max(140, r.top);
    else area.w = Math.max(160, r.left);
    return area;
  }
};

// ------------------------------------------------------------------ Messages
net.on('hello', (m) => {
  voice.configure(m.voice);
  lobby.setVoice(!!m.voice);
  lobby.showOpenGames(m.openGames);
  lobby.showMySeats(m.mySeats);
  if (m.profile) lobby.setProfile(m.profile, true);
  admin.setEnabled(m.admin);
  showPendingNotice();
  // What is new in this release: once by itself, any time from the menu.
  hasNews(m.version).then(has => {
    for (const link of document.querySelectorAll('.news-link')) {
      link.classList.toggle('hidden', !has);
      link.onclick = (e) => { e.preventDefault(); openNews([releaseOf(m.version)]); };
    }
  });
  newsOnHello(m, msg => net.send(msg));
  if (!net.session) lobby.show('menu');
  // Testing aid: ?solo=N starts a game against N AI empires right away
  const solo = new URLSearchParams(location.search).get('solo');
  if (solo && !net.session) lobby.quickStart(Math.max(1, Math.min(15, +solo)));
});

net.on('games', (m) => { lobby.showOpenGames(m.openGames); lobby.showMySeats(m.mySeats); });
net.on('adminData', (m) => admin.update(m));
net.on('adminMsgSent', (m) => admin.messageSent(m));
net.on('adminInviteCreated', (m) => admin.inviteCreated(m));
// An admin speaks to everyone in the game: a banner that has to be
// acknowledged, plus a line in the radio log for later.
net.on('adminMsg', (m) => {
  showAnnouncement(m);
  hud?.chat(`📢 ${m.from || 'Admin'}`, m.text, { system: true });
  sfx.play('warn');
});
// Answer to every profile change - also to a rejected one, then with the old
// state, so no field shows something that does not apply.
net.on('profile', (m) => { lobby.setProfile(m.profile); lobby.relabel(); });
net.on('lobby', (m) => lobby.update(m));
net.on('kicked', () => { net.forget(); location.reload(); });
// An admin ended the game: back to the start screen, and say why once it is there.
net.on('ended', (m) => {
  try { sessionStorage.setItem(NOTICE_KEY, JSON.stringify({ key: m.key, params: m.params })); } catch {}
  net.forget();
  location.reload();
});

// The seat moved to another device of this account: back to the start
// screen, where it can be taken back.
net.on('takenOver', (m) => {
  try { sessionStorage.setItem(NOTICE_KEY, JSON.stringify({ key: 'notice.takenOver', params: { code: m.code } })); } catch {}
  location.reload();
});

// The server sends keys, not sentences - translation happens here.
const message = (m) => m.key ? t(m.key, m.params) : (m.msg || '');

// A message that has to survive a reload (e.g. "an admin ended your game").
const NOTICE_KEY = 'ho-notice';
function showPendingNotice() {
  let notice = null;
  try { notice = JSON.parse(sessionStorage.getItem(NOTICE_KEY) || 'null'); sessionStorage.removeItem(NOTICE_KEY); } catch {}
  // Stays until the next message replaces it - unlike errors it must not
  // vanish before the player has looked at the screen.
  if (notice) $('#menu-error').textContent = message(notice);
}
net.on('error', (m) => {
  const txt = message(m);
  if (!$('#screen-lobby').classList.contains('hidden')) lobby.error('#lobby-error', txt);
  else if (!$('#screen-menu').classList.contains('hidden')) lobby.error('#menu-error', txt);
  else hud?.toast(txt, '#ff5f5f');
  sfx.play('deny');
});
net.on('notice', (m) => { hud?.toast(message(m), '#ffb347'); sfx.play('warn'); });

net.on('view', (m) => {
  const view = m.view;
  app.spectator = !!view.spectator;
  if (!map) {
    lobby.show('game');
    // Classic is flat, space can be rotated freely - otherwise the same game.
    map = view.mode === 'space' ? new SpaceView($('#map')) : new MapView($('#map'));
    map.resize();
    hud = new Hud(app);
    bindGame();
    requestAnimationFrame(loop);
    if (view.turn <= 1) sfx.play('start');
  }
  lobby.show('game');
  map.setView(view);
  voice.setView(view);
  map.selection = app.selection;

  // Clear the selection if it no longer exists
  if (app.selection?.type === 'fleet' && !view.fleets.some(f => f.id === app.selection.id)) {
    app.selection = null;
    map.selection = null;
  }

  const newTurn = view.turn > lastTurn;
  const newBattles = collectBattles(view);
  hud.update(view);
  if (newTurn && lastTurn > 0) {
    if (!view.spectator) showTurnBanner(view);
    playTurnSounds(view);
    // When spectating, the log runs along anyway - only the big moments as
    // pop-ups, otherwise they plaster the screen at a fast pace.
    const loud = view.spectator
      ? ['eliminated', 'victory']
      : ['combat', 'invade', 'colonize', 'eliminated', 'victory', 'galaxy'];
    for (const l of settled(view)) {
      for (const e of l.entries) {
        if (!loud.includes(e.type)) continue;
        const key = `${l.turn}:${e.planetId}`;
        hud.toast(hud.logText(e), null, app.battles.has(key) && e.battle ? () => app.openBattle(key) : null);
      }
    }
    if (newBattles.length) map.playBattles?.(newBattles, view.you);
  }
  lastTurn = view.turn;

  if (view.state === 'over') showWinnerBanner(view);
  else hideWinnerBanner();
});

/** Take over the battle records from the view; returns the new ones. */
function collectBattles(view) {
  const fresh = [];
  for (const l of view.log) {
    for (const e of l.entries) {
      if (!e.battle || e.planetId == null) continue;
      const key = `${l.turn}:${e.planetId}`;
      if (!app.battles.has(key)) fresh.push({ planetId: e.planetId, battle: e.battle });
      app.battles.set(key, { planetId: e.planetId, battle: e.battle });
    }
  }
  while (app.battles.size > 40) app.battles.delete(app.battles.keys().next().value);
  return fresh;
}

net.on('chat', (m) => {
  const text = message({ key: m.key, params: m.params, msg: m.text });
  const mine = !!m.fromId && m.fromId === map?.view?.you;
  hud?.chat(m.from, text, { fromId: m.fromId, system: m.system, mine });
  // Only real system messages pop up as such - recognised by the server's
  // flag, not by the name: a player could be called "System". Lines from
  // other players announce themselves in hud.chat as long as the comms
  // are out of sight.
  if (m.system) hud?.toast(text);
  if (!mine) sfx.play('chat');
});

net.on('voice', (m) => voice.onState(m));
net.on('rtc', (m) => voice.onSignal(m));

net.on('close', () => {
  voice.lost();
  hud?.toast(t('net.lost'), '#ff5f5f');
  sfx.play('offline');
});

// ---------------------------------------------------------------------- Game
function bindGame() {
  bindGameEnd();
  $('#winnerbanner-continue').onclick = () => showGameEnd(map.view);
  map.onSelect = (hit) => {
    if (!hit) { app.setSelection(null); sfx.play('deselect'); return; }
    app.setSelection({ type: hit.type, id: hit.id });
    sfx.play(hit.type === 'fleet' ? 'selectFleet' : 'select',
      { pan: hit.type === 'planet' ? panOf(hit.id) : 0 });
  };
  map.onOrder = (hit) => {
    if (hit?.type === 'planet') app.order(hit.id);
  };
  map.onHoverChange = () => {};

  $('#btn-endturn').onclick = () => {
    if (map.view?.state === 'over') return showGameEnd(map.view);
    const ready = map.view?.me.ready;
    // Last warning in case the build order cannot be paid for - the turn is
    // ended anyway, just no longer as a surprise.
    const pl = !ready ? hud?.plan() : null;
    if (pl && (pl.missingMoney || pl.missingMetal)) {
      const missing = [pl.missingMoney ? Math.round(pl.missingMoney) + ' ' + t('unit.cr') : null,
                       pl.missingMetal ? Math.round(pl.missingMetal) + ' ' + t('unit.metal') : null]
        .filter(Boolean).join(` ${t('word.and')} `);
      hud.toast(t('yard.endTurnWarning', { missing }), '#ffb347');
    }
    net.send({ t: 'ready', value: !ready });
    sfx.play(ready ? 'unready' : 'ready');
  };
  // Host: hold the game for everyone, and let it continue
  $('#btn-pause').onclick = () => {
    const paused = !!map.view?.paused;
    net.send({ t: 'pause', value: !paused });
    sfx.play(paused ? 'ready' : 'unready');
  };
  // Spectators: pace instead of ending the turn
  $('#sp-play').onclick = () => net.send({ t: 'pace', paused: !(map.view?.pace?.paused) });
  $('#sp-step').onclick = () => net.send({ t: 'step' });
  for (const b of document.querySelectorAll('.sp-speeds button')) {
    b.onclick = () => net.send({ t: 'pace', ms: +b.dataset.ms, paused: false });
  }

  // Leave the game - with confirmation, because it cannot be undone
  $('#btn-quit').onclick = () => {
    // Spectators do not leave a game they play in - title, text and buttons
    // follow the role. Through data-i18n, so a language change keeps them.
    const sp = app.spectator;
    const say = (sel, key) => { const el = $(sel); el.dataset.i18n = key; el.textContent = t(key); };
    say('#quit-title', sp ? 'quit.spectatorTitle' : 'quit.title');
    // Only AI games run on the spectators' pace; without anyone watching the server drops them.
    say('#quit-text', sp ? (map.view?.pace ? 'quit.spectatorBots' : 'quit.spectator') : 'quit.player');
    say('#quit-yes', sp ? 'quit.spectatorYes' : 'quit.yes');
    say('#quit-no', sp ? 'quit.spectatorNo' : 'quit.no');
    $('#quit').classList.remove('hidden');
  };
  $('#quit-no').onclick = () => $('#quit').classList.add('hidden');
  $('#quit-yes').onclick = () => {
    net.send({ t: 'leave' });
    net.forget();
    setTimeout(() => location.reload(), 120);    // a moment for signing off
  };

  $('#btn-fit').onclick = () => map.fit();
  $('#btn-zoomin').onclick = () => map.zoomBy(1.25);
  $('#btn-zoomout').onclick = () => map.zoomBy(1 / 1.25);
  // Sheets on narrow devices: only one open at a time, controlled via the bar
  // at the bottom. On wide windows the bar is hidden and data-sheet stays
  // empty - the docks then stand side by side as usual.
  const game = $('#screen-game'), bar = $('#tabbar');
  // size: 'full' or 'peek' (half height) - only portrait phones tell them
  // apart, see the stylesheet.
  const showSheet = (name, size = 'full') => {
    game.dataset.sheet = name || '';
    game.dataset.size = size;
    for (const b of bar.querySelectorAll('button')) {
      b.classList.toggle('active', (b.dataset.sheet || '') === (name || ''));
    }
    showOpts(name === 'opts');
    if (name && name !== 'opts' && hud?.view) hud.update(hud.view);
    hud?.chatSeen();
  };
  for (const b of bar.querySelectorAll('button')) {
    b.onclick = () => showSheet(b.dataset.sheet || '');
  }
  app.showSheet = showSheet;
  // Grip at the top of every sheet: a tap switches between half and full
  // height, dragging up opens it fully, dragging down first shrinks it and
  // then closes it.
  const resize = (size) => {
    game.dataset.size = size;
    if (game.dataset.sheet === 'right') app.refocus();
  };
  for (const dock of ['#leftdock', '#rightdock', '#logdock'].map($)) {
    const grip = document.createElement('div');
    grip.className = 'sheet-grip only-phone';
    dock.prepend(grip);
    let y0 = null;
    grip.addEventListener('pointerdown', (e) => { y0 = e.clientY; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointercancel', () => { y0 = null; });
    grip.addEventListener('pointerup', (e) => {
      if (y0 == null) return;
      const dy = e.clientY - y0, full = game.dataset.size !== 'peek';
      y0 = null;
      if (Math.abs(dy) < 8) resize(full ? 'peek' : 'full');
      else if (dy < 0) resize('full');
      else if (full) resize('peek');
      else showSheet('');
    });
  }
  // When the window gets wide, the bar disappears - then no sheet may stay
  // stuck, otherwise a dock would suddenly be missing.
  narrow.addEventListener('change', (e) => { if (!e.matches) showSheet(''); });

  // Display and sound sit collapsed behind the gear.
  const opts = $('#mapsettings'), optsBtn = $('#btn-mapopts');
  const showOpts = (open) => {
    opts.classList.toggle('hidden', !open);
    optsBtn.classList.toggle('open', open);
    optsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  optsBtn.onclick = () => {
    const open = opts.classList.contains('hidden');
    if (narrow.matches) showSheet(open ? 'opts' : '');
    else showOpts(open);
  };
  // Tapping beside it means close; the click on the map may still go through.
  addEventListener('pointerdown', (e) => {
    if (opts.classList.contains('hidden')) return;
    if (e.target.closest('#mapcorner') || e.target.closest('#tabbar')) return;
    if (narrow.matches) showSheet(''); else showOpts(false);
  });
  // What the map shows is remembered in the browser, like sound and language.
  const MAP_OPTS = 'ho-map';
  let mapOpts = {};
  try { mapOpts = JSON.parse(localStorage.getItem(MAP_OPTS) || '{}') || {}; } catch {}
  for (const [id, prop] of [['#chk-names', 'showNames'], ['#chk-range', 'showRange'],
    ['#chk-terr', 'showTerritory'], ['#chk-stars', 'showStars']]) {
    const box = $(id);
    if (typeof mapOpts[prop] === 'boolean') box.checked = mapOpts[prop];
    map[prop] = box.checked;
    box.onchange = (e) => {
      map[prop] = mapOpts[prop] = e.target.checked;
      try { localStorage.setItem(MAP_OPTS, JSON.stringify(mapOpts)); } catch {}
    };
  }
  const snd = $('#chk-sound'), vol = $('#snd-vol');
  snd.checked = sfx.on;
  vol.value = Math.round(sfx.volume * 100);
  snd.onchange = e => { sfx.setEnabled(e.target.checked); if (e.target.checked) sfx.play('select'); };
  vol.oninput = e => sfx.setVolume(+e.target.value / 100);
  vol.onchange = () => sfx.play('select');
  // Full screen where the browser can do it (Android, iPad, desktop). Safari on
  // the iPhone cannot - there only "Add to Home Screen" helps (manifest).
  // Started from the home screen, the browser bars are gone anyway.
  const root = document.documentElement;
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const fsRequest = root.requestFullscreen || root.webkitRequestFullscreen;
  const fsExit = document.exitFullscreen || document.webkitExitFullscreen;
  const installed = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
  if (fsRequest && !installed && (document.fullscreenEnabled ?? document.webkitFullscreenEnabled)) {
    const fs = $('#chk-fullscreen');
    $('#row-fullscreen').classList.remove('hidden');
    const sync = () => { fs.checked = !!fsElement(); };
    fs.onchange = () => {
      const p = fs.checked ? fsRequest.call(root, { navigationUI: 'hide' }) : fsExit.call(document);
      Promise.resolve(p).catch(sync);
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
  }
  const emojiPicker = bindEmoji($('#chat-input'), $('#chat-emoji'));
  onLocaleChange(() => emojiPicker.relabel());
  $('#chat-input').onkeydown = (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      // A smiley at the very end only counts now that the line is finished.
      net.send({ t: 'chat', text: emojify(e.target.value) });
      e.target.value = '';
    }
  };
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === ' ') { e.preventDefault(); $(app.spectator ? '#sp-play' : '#btn-endturn').click(); }
    if (e.key === 'f' || e.key === 'F') map.fit();
    if ((e.key === 'p' || e.key === 'P') && !$('#btn-pause').classList.contains('hidden')) $('#btn-pause').click();
    if (e.key === 't' || e.key === 'T') map.topView?.();
    if (e.key === 'Escape') {
      if (!opts.classList.contains('hidden')) showOpts(false);
      else app.setSelection(null);
    }
    if (e.key === 'h' || e.key === 'H') $('#help').classList.toggle('hidden');
    if (e.key === '+') map.zoomBy(1.25);
    if (e.key === '-') map.zoomBy(1 / 1.25);
  });
}

/** Stereo position of a planet on screen, -0.7 to 0.7. */
function panOf(planetId) {
  const p = planetId != null ? map?.view?.planets[planetId] : null;
  if (!p) return 0;
  const [sx] = map.w2s(p.x, p.y, p.z);
  return Math.max(-1, Math.min(1, (sx / map.w) * 2 - 1)) * 0.7;
}

// Important things first: with many events, the rest falls by the wayside.
const SFX_PRIO = ['victory', 'eliminated', 'lost', 'invade', 'combat', 'expand',
  'colonize', 'settle', 'tech', 'build', 'terra', 'arrive', 'warn'];

/**
 * What the turn resolution that just ran reported. The server increments the
 * turn first and files the messages afterwards - so they already carry the
 * new number. With "view.turn - 1", toasts and sounds came one turn too late
 * (and looked duplicated next to the log).
 */
function settled(view) {
  return view.log.filter(l => l.turn === view.turn);
}

/** Turn resolution: first the gong, then the events of the last turn. */
function playTurnSounds(view) {
  // When spectating at a fast pace, the gong would strike every second
  if (!view.spectator || (view.pace?.ms ?? 1500) >= 1000) sfx.play('turn');
  const picks = [];
  for (const l of settled(view)) {
    for (const e of l.entries) {
      const name = LOG_SFX[e.type];
      if (name) picks.push({ name, pan: panOf(e.planetId) });
    }
  }
  picks.sort((a, b) => SFX_PRIO.indexOf(a.name) - SFX_PRIO.indexOf(b.name));
  picks.slice(0, view.spectator ? 3 : 10).forEach((pick, i) => {
    setTimeout(() => sfx.play(pick.name, { pan: pick.pan }), 180 + i * 90);
  });
}

// Debug access for the console and automated tests
window.__ho = { app, get map() { return map; }, get view() { return map?.view; }, net, sfx };

// When idle, a fraction of the frame rate is enough: the game is turn-based,
// only stars, course lines and orbits twinkle. Full rate on input and after
// a new view (map.poke()).
const IDLE_FPS = 20;
let last = performance.now();
let lastDraw = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (document.hidden) { last = now; return; }
  if (!map.busy && now - lastDraw < 1000 / IDLE_FPS - 1) return;
  const dt = Math.min(0.12, (now - last) / 1000);
  last = now;
  lastDraw = now;
  if (map.cv.clientWidth !== map.w || map.cv.clientHeight !== map.h
    || Math.min(2, window.devicePixelRatio || 1) !== map.dpr) map.resize();
  map.draw(dt);
  hud.timer();
}

function showTurnBanner(view) {
  const b = $('#turnbanner');
  b.innerHTML = `<div class="big">${t('log.turnHeader', { turn: view.turn })}</div>`;
  b.classList.remove('hidden');
  clearTimeout(showTurnBanner._t);
  showTurnBanner._t = setTimeout(() => b.classList.add('hidden'), 1100);
}

/** Who won, right on the screen - stays up until the game is left or
 * continued; "Weiter" (bound in bindGame()) is what opens the dialog about
 * either of those. */
function showWinnerBanner(view) {
  const winner = view.players.find(p => p.id === view.winner);
  $('#winnerbanner-text').textContent = t('over.winner', { player: winner ? winner.name : '—' });
  $('#winnerbanner').classList.remove('hidden');
}

function hideWinnerBanner() {
  $('#winnerbanner').classList.add('hidden');
}

/** Opens the dialog about a game that has ended: ask whether to keep playing,
 * with more turns, or go back to the start screen. Triggered by "Weiter" -
 * on the winner banner, or the same button at the top once the game is over.
 * Only the host gets asked - others only get the option to leave or dismiss. */
function showGameEnd(view) {
  const winner = view.players.find(p => p.id === view.winner);
  openGameEnd({
    winnerText: t('over.winner', { player: winner ? winner.name : '—' }),
    isHost: view.host === view.you,
    // Staying without going back to the start screen: the same wording the
    // leave-game dialog uses for "never mind" - by role, same as there.
    stayLabel: t(view.spectator ? 'quit.spectatorNo' : 'quit.no'),
    continueCallback: (turns) => net.send({ t: 'continue', turns }),
    leaveCallback: () => { net.forget(); location.reload(); },
    dismissCallback: () => {}
  });
}
