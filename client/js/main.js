// Einstiegspunkt: verdrahtet Netzwerk, Lobby, Karte und Oberfläche.
import { Net } from './net.js';
import { Lobby } from './ui/lobby.js';
import { Hud } from './ui/hud.js';
import { openShipInfo } from './ui/shipinfo.js';
import { openBattle } from './ui/battle.js';
import { MapView } from './render/map.js';
import { SpaceView } from './render/space.js';
import { sfx, bindUi, LOG_SFX } from './audio/sfx.js';
import { enhanceSelects, syncSelects } from './ui/select.js';
import { klein } from './ui/viewport.js';
import { initLocale, useLocale, onLocaleChange, localeName, t, availableLocales, getLocale } from './i18n.js';

const $ = s => document.querySelector(s);
// Zu schmal oder zu niedrig fuer nebeneinanderliegende Docks: dann gilt die
// Blattleiste. Entschieden wird nach Platz, nicht nach Art des Zeigers - ein
// geteiltes Fenster am Rechner hat dasselbe Problem wie ein Telefon.
const schmal = klein;

// Sprache zuerst: Markup und Panels werden danach schon uebersetzt gebaut.
initLocale();
sprachwahl();
bindUi();
enhanceSelects();

/**
 * Auswahlfelder fuer die Sprache, im Startmenue und im Spiel (Zahnrad unten
 * rechts). Ein Wechsel schreibt die Wahl
 * fest, uebersetzt das Markup neu und laesst die Panels sich neu aufbauen -
 * ohne Neuladen, damit eine laufende Partie weitergeht.
 */
function sprachwahl() {
  // Startmenü und Karteneinstellungen im Spiel - beide zeigen dieselbe Wahl.
  const felder = ['#in-lang', '#in-lang-game'].map(s => document.querySelector(s)).filter(Boolean);
  if (!felder.length) return;
  // Einmal aufbauen; spaeter nur die Texte auffrischen, damit die eigene
  // Auswahlliste (select.js) nicht neu gebaut werden muss.
  for (const sel of felder) {
    sel.innerHTML = availableLocales()
      .map(code => `<option value="${code}"></option>`).join('');
    sel.onchange = () => useLocale(sel.value);
  }
  const male = () => {
    for (const sel of felder) {
      for (const opt of sel.options) opt.textContent = localeName(opt.value);
      sel.value = getLocale();
    }
  };
  male();
  onLocaleChange(() => {
    male();
    syncSelects();                 // Knopfbeschriftungen der eigenen Listen
    lobby?.relabel();
    // Der Sprachwechsel schreibt die Reiter aus dem Markup neu - beim Zusehen
    // heisst der erste aber "Imperien", nicht "Forschung".
    hud?.chrome();
    if (hud?.view) hud.update(hud.view);
  });
}

/**
 * Konto und Abmelden unter der Sprachwahl. Laeuft der Server ohne Anmeldung
 * (HO_AUTH=off), antwortet /api/auth/me mit 404 und die Zeile bleibt weg.
 */
async function konto() {
  const zeile = document.querySelector('#account-row');
  const name = document.querySelector('#account-name');
  if (!zeile) return;
  let wer = null;
  try {
    const r = await fetch('api/auth/me', { cache: 'no-store' });
    if (!r.ok) return;
    const me = await r.json();
    wer = me.display || me.user;
  } catch { return; }
  if (!wer) return;
  // Den Anzeigenamen setzt das Profil (net 'hello'); er darf vom Kontonamen
  // abweichen. Hier steht nur, mit welchem Konto man angemeldet ist.
  const male = () => {
    name.textContent = t('auth.signedInAs', { user: wer });
  };
  male();
  onLocaleChange(male);
  zeile.classList.remove('hidden');
  document.querySelector('#link-logout').onclick = async (e) => {
    e.preventDefault();
    net.forget();
    try { await fetch('api/auth/logout', { method: 'POST' }); } catch { /* egal */ }
    location.replace('login.html');
  };
}

const net = new Net();
const lobby = new Lobby(net);
konto();
let map = null;
let hud = null;
// Aus der Anleitung heraus: im Spiel mit dem eigenen Techstand, sonst mit der Startstufe.
document.querySelector('#help-ships').onclick = () => {
  if (hud) hud.showShip('scout');
  else openShipInfo('scout');
};
let lastTurn = 0;

const app = {
  selection: null,
  spectator: false,
  // Schlachtmitschriften je "Runde:Welt". Der Server schickt sie nur fuer die
  // juengste Runde mit, also werden sie hier gesammelt.
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
    // Auf dem Telefon ist das Panel nicht nebenbei zu sehen: angetippt heisst
    // aufgeschlagen, auf freie Karte getippt heisst zugeklappt. Dabei rueckt
    // das Gewaehlte in den Teil der Karte, den das Blatt frei laesst.
    if (schmal.matches) {
      app.showSheet?.(sel ? 'right' : '');
      if (sel && map) {
        const ziel = sel.type === 'planet' ? map.view?.planets[sel.id]
          : map.view?.fleets.find(f => f.id === sel.id);
        if (ziel) map.focus(ziel, app.freiesFeld());
      }
    }
  },
  order(planetId) {
    if (app.spectator) return;
    const sel = app.selection;
    const fleetId = sel?.type === 'fleet' ? sel.id : hud?.lastFleetId;
    // Nur eine Flotte befehlen, die es in dieser Sicht wirklich gibt und die
    // uns gehoert - sonst verschluckt der Server den Befehl und es sieht aus,
    // als haette der Knopf nicht gedrueckt.
    const flotte = map?.view?.fleets.find(f => f.id === fleetId);
    if (!fleetId || !flotte || !flotte.mine) {
      hud?.toast(t('fleet.selectFirst')); sfx.play('deny'); return;
    }
    net.send({ t: 'orders', move: { fleetId, planetId } });
    sfx.play('course', { pan: panOf(planetId) });
  },
  get map() { return map; },
  /**
   * Der Teil der Karte, den gerade kein Blatt verdeckt. Hochkant liegt das
   * Blatt unten, quer an der Seite - beides kommt hier als freies Rechteck
   * heraus, damit die Auswahl im sichtbaren Teil landet.
   */
  freiesFeld() {
    const feld = { w: map ? map.w : innerWidth, h: map ? map.h : innerHeight };
    if (!schmal.matches) return feld;
    const offen = document.querySelector('#screen-game[data-sheet]:not([data-sheet=""])');
    if (!offen) return feld;
    const blatt = [...offen.querySelectorAll('#leftdock, #rightdock, #logdock')]
      .find(e => getComputedStyle(e).display !== 'none');
    if (!blatt) return feld;
    const r = blatt.getBoundingClientRect();
    // Nimmt es die ganze Breite ein, liegt es unten; sonst an der Seite.
    if (r.width > feld.w * 0.9) feld.h = Math.max(140, r.top);
    else feld.w = Math.max(160, r.left);
    return feld;
  }
};

// ----------------------------------------------------------------- Nachrichten
net.on('hello', (m) => {
  lobby.showOpenGames(m.openGames);
  if (m.profile) lobby.setProfile(m.profile, true);
  if (!net.session) lobby.show('menu');
  // Testhilfe: ?solo=N startet direkt eine Partie gegen N KI-Reiche
  const solo = new URLSearchParams(location.search).get('solo');
  if (solo && !net.session) lobby.quickStart(Math.max(1, Math.min(15, +solo)));
});

net.on('games', (m) => lobby.showOpenGames(m.openGames));
// Antwort auf jede Profilaenderung - auch auf eine abgelehnte, dann mit dem
// alten Stand, damit kein Feld etwas zeigt, das nicht gilt.
net.on('profile', (m) => { lobby.setProfile(m.profile); lobby.relabel(); });
net.on('lobby', (m) => lobby.update(m));
net.on('kicked', () => { net.forget(); location.reload(); });

// Der Server schickt Schluessel, keine Saetze - uebersetzt wird hier.
const meldung = (m) => m.key ? t(m.key, m.params) : (m.msg || '');
net.on('error', (m) => {
  const txt = meldung(m);
  if (!$('#screen-lobby').classList.contains('hidden')) lobby.error('#lobby-error', txt);
  else if (!$('#screen-menu').classList.contains('hidden')) lobby.error('#menu-error', txt);
  else hud?.toast(txt, '#ff5f5f');
  sfx.play('deny');
});
net.on('notice', (m) => { hud?.toast(meldung(m), '#ffb347'); sfx.play('warn'); });

net.on('view', (m) => {
  const view = m.view;
  app.spectator = !!view.spectator;
  if (!map) {
    lobby.show('game');
    // Klassik ist flach, Raum ist frei drehbar - sonst dieselbe Partie.
    map = view.mode === 'space' ? new SpaceView($('#map')) : new MapView($('#map'));
    map.resize();
    hud = new Hud(app);
    bindGame();
    requestAnimationFrame(loop);
    if (view.turn <= 1) sfx.play('start');
  }
  lobby.show('game');
  map.setView(view);
  map.selection = app.selection;

  // Auswahl bereinigen, falls sie nicht mehr existiert
  if (app.selection?.type === 'fleet' && !view.fleets.some(f => f.id === app.selection.id)) {
    app.selection = null;
    map.selection = null;
  }

  const newTurn = view.turn > lastTurn;
  const neueSchlachten = merkeSchlachten(view);
  hud.update(view);
  if (newTurn && lastTurn > 0) {
    if (!view.spectator) showTurnBanner(view);
    playTurnSounds(view);
    // Beim Zusehen läuft das Protokoll ohnehin mit - nur die großen Momente
    // als Einblendung, sonst pflastern sie im schnellen Takt den Bildschirm zu.
    const loud = view.spectator
      ? ['eliminated', 'victory']
      : ['combat', 'invade', 'colonize', 'eliminated', 'victory', 'galaxy'];
    for (const l of abgerechnet(view)) {
      for (const e of l.entries) {
        if (!loud.includes(e.type)) continue;
        const key = `${l.turn}:${e.planetId}`;
        hud.toast(hud.logText(e), null, app.battles.has(key) && e.battle ? () => app.openBattle(key) : null);
      }
    }
    if (neueSchlachten.length) map.playBattles?.(neueSchlachten, view.you);
  }
  lastTurn = view.turn;

  if (view.state === 'over') showEnd(view);
});

/** Mitschriften aus der Sicht uebernehmen; zurueck kommen die neuen. */
function merkeSchlachten(view) {
  const neu = [];
  for (const l of view.log) {
    for (const e of l.entries) {
      if (!e.battle || e.planetId == null) continue;
      const key = `${l.turn}:${e.planetId}`;
      if (!app.battles.has(key)) neu.push({ planetId: e.planetId, battle: e.battle });
      app.battles.set(key, { planetId: e.planetId, battle: e.battle });
    }
  }
  while (app.battles.size > 40) app.battles.delete(app.battles.keys().next().value);
  return neu;
}

net.on('chat', (m) => {
  const text = meldung({ key: m.key, params: m.params, msg: m.text });
  hud?.chat(m.from, text);
  if (m.from === 'System') hud?.toast(text);
  sfx.play('chat');
});

net.on('close', () => {
  hud?.toast(t('net.lost'), '#ff5f5f');
  sfx.play('offline');
});

// --------------------------------------------------------------------- Spiel
function bindGame() {
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
    const ready = map.view?.me.ready;
    // Letzte Warnung, falls der Bauauftrag nicht bezahlt werden kann - der
    // Zug wird trotzdem abgeschlossen, nur nicht mehr ueberrascht.
    const pl = !ready ? hud?.plan() : null;
    if (pl && (pl.fehltGeld || pl.fehltErz)) {
      const fehlt = [pl.fehltGeld ? Math.round(pl.fehltGeld) + ' ' + t('unit.cr') : null,
                     pl.fehltErz ? Math.round(pl.fehltErz) + ' ' + t('unit.metal') : null]
        .filter(Boolean).join(` ${t('word.and')} `);
      hud.toast(t('yard.endTurnWarning', { missing: fehlt }), '#ffb347');
    }
    net.send({ t: 'ready', value: !ready });
    sfx.play(ready ? 'unready' : 'ready');
  };
  // Zuschauer: Takt statt Zugende
  $('#sp-play').onclick = () => net.send({ t: 'pace', paused: !(map.view?.pace?.paused) });
  $('#sp-step').onclick = () => net.send({ t: 'step' });
  for (const b of document.querySelectorAll('.sp-speeds button')) {
    b.onclick = () => net.send({ t: 'pace', ms: +b.dataset.ms, paused: false });
  }

  // Partie verlassen - mit Rückfrage, weil es nicht rückgängig zu machen ist
  $('#btn-quit').onclick = () => {
    $('#quit-text').textContent = t(app.spectator ? 'quit.spectator' : 'quit.player');
    $('#quit').classList.remove('hidden');
  };
  $('#btn-quit2').onclick = () => $('#btn-quit').onclick();
  $('#quit-no').onclick = () => $('#quit').classList.add('hidden');
  $('#quit-yes').onclick = () => {
    net.send({ t: 'leave' });
    net.forget();
    setTimeout(() => location.reload(), 120);    // kurz Zeit für die Abmeldung
  };

  $('#btn-fit').onclick = () => map.fit();
  $('#btn-zoomin').onclick = () => map.zoomBy(1.25);
  $('#btn-zoomout').onclick = () => map.zoomBy(1 / 1.25);
  // Blaetter auf schmalen Geraeten: immer nur eines offen, gesteuert ueber
  // die Leiste unten. Auf breiten Fenstern ist die Leiste versteckt und
  // data-sheet bleibt leer - die Docks stehen dann wie gehabt nebeneinander.
  const spiel = $('#screen-game'), leiste = $('#tabbar');
  const zeigeBlatt = (name) => {
    spiel.dataset.sheet = name || '';
    for (const b of leiste.querySelectorAll('button')) {
      b.classList.toggle('active', (b.dataset.sheet || '') === (name || ''));
    }
    zeigeOpts(name === 'opts');
    if (name && name !== 'opts' && hud?.view) hud.update(hud.view);
  };
  for (const b of leiste.querySelectorAll('button')) {
    b.onclick = () => zeigeBlatt(b.dataset.sheet || '');
  }
  app.showSheet = zeigeBlatt;
  // Wird das Fenster breit, verschwindet die Leiste - dann darf kein Blatt
  // haengenbleiben, sonst fehlt plotzlich ein Dock.
  schmal.addEventListener('change', (e) => { if (!e.matches) zeigeBlatt(''); });

  // Anzeige und Ton liegen eingeklappt hinter dem Zahnrad.
  const opts = $('#mapsettings'), optsBtn = $('#btn-mapopts');
  const zeigeOpts = (auf) => {
    opts.classList.toggle('hidden', !auf);
    optsBtn.classList.toggle('auf', auf);
    optsBtn.setAttribute('aria-expanded', auf ? 'true' : 'false');
  };
  optsBtn.onclick = () => {
    const auf = opts.classList.contains('hidden');
    if (schmal.matches) zeigeBlatt(auf ? 'opts' : '');
    else zeigeOpts(auf);
  };
  // Daneben getippt heisst zu; der Klick auf die Karte darf trotzdem ankommen.
  addEventListener('pointerdown', (e) => {
    if (opts.classList.contains('hidden')) return;
    if (e.target.closest('#mapcorner') || e.target.closest('#tabbar')) return;
    if (schmal.matches) zeigeBlatt(''); else zeigeOpts(false);
  });
  $('#chk-names').onchange = e => map.showNames = e.target.checked;
  $('#chk-range').onchange = e => map.showRange = e.target.checked;
  $('#chk-terr').onchange = e => map.showTerritory = e.target.checked;
  $('#chk-stars').onchange = e => map.showStars = e.target.checked;
  const snd = $('#chk-sound'), vol = $('#snd-vol');
  snd.checked = sfx.on;
  vol.value = Math.round(sfx.volume * 100);
  snd.onchange = e => { sfx.setEnabled(e.target.checked); if (e.target.checked) sfx.play('select'); };
  vol.oninput = e => sfx.setVolume(+e.target.value / 100);
  vol.onchange = () => sfx.play('select');
  $('#chat-input').onkeydown = (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      net.send({ t: 'chat', text: e.target.value });
      e.target.value = '';
    }
  };
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === ' ') { e.preventDefault(); $(app.spectator ? '#sp-play' : '#btn-endturn').click(); }
    if (e.key === 'f' || e.key === 'F') map.fit();
    if (e.key === 't' || e.key === 'T') map.topView?.();
    if (e.key === 'Escape') {
      if (!opts.classList.contains('hidden')) zeigeOpts(false);
      else app.setSelection(null);
    }
    if (e.key === 'h' || e.key === 'H') $('#help').classList.toggle('hidden');
    if (e.key === '+') map.zoomBy(1.25);
    if (e.key === '-') map.zoomBy(1 / 1.25);
  });
}

/** Stereoposition eines Planeten auf dem Bildschirm, -0,7 bis 0,7. */
function panOf(planetId) {
  const p = planetId != null ? map?.view?.planets[planetId] : null;
  if (!p) return 0;
  const [sx] = map.w2s(p.x, p.y, p.z);
  return Math.max(-1, Math.min(1, (sx / map.w) * 2 - 1)) * 0.7;
}

// Wichtiges zuerst: bei vielen Ereignissen fällt der Rest unter den Tisch.
const SFX_PRIO = ['victory', 'eliminated', 'lost', 'invade', 'combat', 'expand',
  'colonize', 'settle', 'tech', 'build', 'terra', 'arrive', 'warn'];

/**
 * Was die gerade gelaufene Abrechnung gemeldet hat. Der Server zaehlt die
 * Runde erst hoch und legt die Meldungen danach ab - sie tragen also schon
 * die neue Nummer. Mit "view.turn - 1" kamen Toasts und Geraeusche eine
 * Runde zu spaet (und wirkten neben dem Protokoll wie doppelt).
 */
function abgerechnet(view) {
  return view.log.filter(l => l.turn === view.turn);
}

/** Rundenabrechnung: erst der Gong, dann die Ereignisse der letzten Runde. */
function playTurnSounds(view) {
  // Beim Zusehen im schnellen Takt schlüge der Gong jede Sekunde
  if (!view.spectator || (view.pace?.ms ?? 1500) >= 1000) sfx.play('turn');
  const picks = [];
  for (const l of abgerechnet(view)) {
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

// Debug-Zugriff für Konsole und automatisierte Tests
window.__ho = { app, get map() { return map; }, get view() { return map?.view; }, net, sfx };

// Im Leerlauf reicht ein Bruchteil der Bildrate: das Spiel ist rundenbasiert,
// es blinken nur Sterne, Kurslinien und Orbits. Volle Rate gibt es bei Eingabe
// und nach einer neuen Sicht (map.poke()).
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
  b.innerHTML = `<div class="big">Runde ${view.turn}</div>`;
  b.classList.remove('hidden');
  clearTimeout(showTurnBanner._t);
  showTurnBanner._t = setTimeout(() => b.classList.add('hidden'), 1100);
}

function showEnd(view) {
  if (showEnd._done) return;
  showEnd._done = true;
  const w = view.players.find(p => p.id === view.winner);
  const b = $('#turnbanner');
  b.innerHTML = `<div style="text-align:center">
    <div class="big">${t('over.winner', { player: w ? w.name : '—' })}</div>
    <p class="muted">${t('over.title')}</p>
    <button class="primary" onclick="localStorage.removeItem('ho-session');location.reload()">${t('over.newGame')}</button>
  </div>`;
  b.style.pointerEvents = 'auto';
  b.classList.remove('hidden');
}
