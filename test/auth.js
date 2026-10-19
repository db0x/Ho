// Der Zugang vor der Lobby. Geprüft wird nicht die Oberfläche, sondern das,
// worauf es ankommt: dass ohne Sitzung nichts herauskommt - auch keine
// WebSocket, denn über die läuft das Spiel.
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  hashPassword, verifyPassword, addUser, deleteUser, listUsers, getUser,
  setPassword, verifyUser, generatePassword, checkPassword, validName, setDisplay
} from '../server/userstore.js';

// Eigene Kontendatei, damit kein echter Bestand angetastet wird.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ho-auth-'));
const USERS = path.join(dir, 'users.json');
process.env.HO_USERS_FILE = USERS;

let fehler = 0;
const check = (cond, msg) => {
  if (!cond) { console.error('FEHLER: ' + msg); fehler++; }
  return cond;
};
const wait = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------- Hashes
{
  const hash = await hashPassword('einPasswort123');
  check(hash.startsWith('scrypt$'), 'Hash nennt sein Verfahren nicht');
  check(!hash.includes('einPasswort123'), 'Das Passwort steht im Hash');
  check(await verifyPassword('einPasswort123', hash), 'Richtiges Passwort wird abgewiesen');
  check(!await verifyPassword('einPasswort124', hash), 'Falsches Passwort wird angenommen');
  check(!await verifyPassword('', hash), 'Leeres Passwort wird angenommen');
  check(!await verifyPassword('einPasswort123', 'unsinn'), 'Kaputter Hash lässt durch');
  const zweiter = await hashPassword('einPasswort123');
  check(hash !== zweiter, 'Gleiches Passwort ergibt denselben Hash - es fehlt das Salz');
  console.log('scrypt-Hashes: gesalzen, prüfbar, ohne Klartext.');
}

// -------------------------------------------------------------------- Konten
{
  const r = await addUser('captain');
  check(r.generated && r.password.length >= 12, 'Erstes Passwort ist nicht gewürfelt');
  check(getUser('captain').mustChange, 'Neues Konto verlangt keinen Passwortwechsel');
  check(!JSON.stringify(getUser('captain')).includes(r.password), 'Konto enthält das Passwort');
  check(await verifyUser('CAPTAIN', r.password), 'Groß geschriebener Name wird abgewiesen');
  check(!await verifyUser('captain', 'falsch'), 'Falsches Passwort wird angenommen');
  check(!await verifyUser('gibtesnicht', r.password), 'Unbekanntes Konto wird angenommen');

  // Schreibweise: Schlüssel klein, Anzeige wie angelegt
  const b = await addUser('BATMAN');
  check(b.name === 'batman' && b.display === 'BATMAN', `Schreibweise beim Anlegen verloren (${b.display})`);
  const bv = await verifyUser('batman', b.password);
  check(bv && bv.display === 'BATMAN', 'Anmeldung klein geschrieben liefert nicht die Schreibweise');
  check(setDisplay('batman', 'BatMan').display === 'BatMan', 'Schreibweise lässt sich nicht ändern');
  let falsch = null;
  try { setDisplay('batman', 'Joker'); } catch (e) { falsch = e.message; }
  check(falsch === 'auth.cli.badSpelling', 'Umbenennen über die Schreibweise möglich');
  check(setDisplay('batman', 'batman').display === 'batman' && !getUser('batman').display,
    'Rückkehr zur Kleinschreibung lässt display stehen');
  deleteUser('batman');
  console.log('Schreibweise: angelegt wie getippt, Anmeldung ohne Groß/Klein, nur Groß/Klein änderbar.');

  let doppelt = null;
  await addUser('captain').catch(e => { doppelt = e.message; });
  check(doppelt === 'auth.cli.exists', `Doppeltes Konto nicht abgewiesen (${doppelt})`);

  check(!validName('Mit Leerzeichen') && !validName('x') && validName('tom.92'),
    'Namensprüfung lässt Unsinn durch');
  check(checkPassword('kurz') === 'auth.err.tooShort', 'Zu kurzes Passwort geht durch');
  check(checkPassword('captain1', 'captain1') === 'auth.err.sameAsUser',
    'Passwort darf nicht der Name sein');

  await addUser('zweiter', 'nochEinPasswort');
  check(listUsers().length === 2, 'Liste zählt falsch');
  check(deleteUser('zweiter') && listUsers().length === 1, 'Löschen wirkt nicht');
  check(!deleteUser('zweiter'), 'Zweites Löschen meldet Erfolg');
  console.log('Anlegen, Prüfen, Auflisten und Löschen von Konten.');
}

// Der Spieler, mit dem der Server geprüft wird: erstes Passwort, Wechsel fällig.
const ERST = generatePassword();
await setPassword('captain', ERST, { mustChange: true });

// --------------------------------------------------------------- Der Server
const PORT = 8411 + Math.floor(Math.random() * 300);
const BASIS = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), HO_USERS_FILE: USERS, HO_AUTH: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stderr.on('data', d => process.stderr.write('[server] ' + d));
await new Promise(r => server.stdout.once('data', r));

let keks = null;                            // die Sitzung, wie ein Browser sie hält

/** Anfrage wie aus einem Browser: mit Keks, ohne automatisches Folgen. */
async function hole(pfad, opt = {}) {
  const r = await fetch(BASIS + pfad, {
    redirect: 'manual',
    ...opt,
    headers: { ...(keks ? { cookie: keks } : {}), ...(opt.headers || {}) }
  });
  const gesetzt = r.headers.get('set-cookie');
  if (gesetzt) {
    const paar = gesetzt.split(';')[0];
    keks = paar.endsWith('=') ? null : paar;      // Max-Age=0 meldet sich so ab
  }
  let body = null;
  try { body = await r.json(); } catch { /* HTML oder leer */ }
  return { status: r.status, ort: r.headers.get('location'), body, roh: r };
}

const seite = { accept: 'text/html' };
const alsJson = (daten) => ({
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daten)
});

/** Lässt sich eine Partie öffnen? Nur dann ist man wirklich im Spiel. */
function wsVersuch() {
  return new Promise((ok) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: keks ? { cookie: keks } : {} });
    const fertig = (r) => { try { ws.close(); } catch { /* egal */ } ok(r); };
    ws.on('message', (raw) => {
      if (JSON.parse(raw.toString()).t === 'hello') fertig('hello');
    });
    ws.on('unexpected-response', (_, res) => fertig('abgewiesen ' + res.statusCode));
    ws.on('error', () => fertig('abgewiesen'));
    setTimeout(() => fertig('still'), 3000);
  });
}

// --- Ohne Sitzung kommt nichts heraus
{
  const wurzel = await hole('/', { headers: seite });
  check(wurzel.status === 302 && wurzel.ort === 'login.html',
    `/ führt nicht zur Anmeldung (${wurzel.status} ${wurzel.ort})`);
  const client = await hole('/js/main.js');
  check(client.status === 401, `Der Spielclient kommt ohne Sitzung heraus (${client.status})`);
  const regeln = await hole('/shared/rules.js');
  check(regeln.status === 401, `Die Regeln kommen ohne Sitzung heraus (${regeln.status})`);
  const tief = await hole('/js/ui/hud.js', { headers: seite });
  check(tief.status === 302 && tief.ort === '../../login.html?next=%2Fjs%2Fui%2Fhud.js',
    `Tiefer Verweis merkt sich das Ziel nicht (${tief.ort})`);

  const anmeldeseite = await hole('/login.html', { headers: seite });
  check(anmeldeseite.status === 200, 'Die Anmeldeseite selbst ist nicht zu erreichen');
  for (const pfad of ['/js/login.js', '/js/i18n.js', '/shared/i18n.js', '/i18n/de.json', '/css/style.css', '/img/logo.svg']) {
    const r = await hole(pfad);
    check(r.status === 200, `Die Anmeldeseite kann ${pfad} nicht laden (${r.status})`);
  }
  check(await wsVersuch() !== 'hello', 'Ohne Sitzung kommt eine WebSocket zustande');

  // Die Freigabeliste darf sich nicht umgehen lassen. Ein kodierter
  // Schraegstrich uebersteht den URL-Parser und wird erst beim Dekodieren zum
  // Trenner - ohne Normalisierung fuehrte /css/..%2f..%2f aus dem Client heraus.
  for (const trick of ['/css/..%2f..%2fserver%2findex.js', '/css/..%2f..%2fpackage.json',
    '/i18n/..%2fjs%2fmain.js', '/img/%2e%2e/%2e%2e/server/userstore.js',
    '/css/..%5c..%5cpackage.json']) {
    const r = await fetch(BASIS + trick, { redirect: 'manual' });
    const text = await r.text();
    check(r.status !== 200, `${trick} kommt ohne Sitzung heraus (${r.status})`);
    check(!/WebSocketServer|scrypt|"ho-web"/.test(text),
      `${trick} liefert Projektdateien aus`);
  }
  console.log('Ohne Sitzung: kein Client, keine Regeln, keine WebSocket, kein Pfadtrick.');
}

// --- Anmelden
{
  const falsch = await hole('/api/auth/login', alsJson({ user: 'captain', password: 'daneben' }));
  check(falsch.status === 401 && falsch.body.error === 'auth.err.badLogin',
    `Falsches Passwort wird nicht abgewiesen (${falsch.status})`);
  check(!keks, 'Nach einer abgewiesenen Anmeldung gibt es einen Keks');

  const fremd = await hole('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'user=captain&password=' + ERST
  });
  check(fremd.status === 400, `Ein Formular von fremder Seite kommt durch (${fremd.status})`);

  const gut = await hole('/api/auth/login', alsJson({ user: 'captain', password: ERST }));
  check(gut.status === 200 && gut.body.mustChange === true,
    `Anmeldung schlägt fehl oder verlangt keinen Wechsel (${gut.status})`);
  check(keks && keks.startsWith('ho_sid='), 'Es kommt kein Sitzungskeks');
  const roh = gut.roh.headers.get('set-cookie');
  check(/HttpOnly/i.test(roh) && /SameSite=Lax/i.test(roh),
    `Der Keks ist nicht abgeschirmt (${roh})`);
  console.log('Anmeldung: falsches Passwort abgewiesen, richtiges bringt eine Sitzung.');
}

// --- Solange das erste Passwort gilt, geht es nicht weiter als bis zum Wechsel
{
  const wurzel = await hole('/', { headers: seite });
  check(wurzel.status === 302 && wurzel.ort === 'login.html',
    `Vor dem Passwortwechsel kommt der Client heraus (${wurzel.status})`);
  check(await wsVersuch() !== 'hello', 'Vor dem Passwortwechsel kommt eine WebSocket zustande');
  const me = await hole('/api/auth/me');
  check(me.status === 200 && me.body.mustChange === true, 'me meldet den fälligen Wechsel nicht');
  console.log('Vor dem Passwortwechsel: Sitzung ja, Spiel nein.');
}

// --- Passwortwechsel
const NEU = 'meinEigenes-2026';
{
  const ohneAlt = await hole('/api/auth/change', alsJson({ password: 'daneben', newPassword: NEU }));
  check(ohneAlt.status === 401, `Wechsel ohne das bisherige Passwort geht durch (${ohneAlt.status})`);

  const zuKurz = await hole('/api/auth/change', alsJson({ password: ERST, newPassword: 'kurz' }));
  check(zuKurz.status === 400 && zuKurz.body.error === 'auth.err.tooShort',
    `Zu kurzes Passwort geht durch (${zuKurz.status})`);

  const gleich = await hole('/api/auth/change', alsJson({ password: ERST, newPassword: ERST }));
  check(gleich.status === 400 && gleich.body.error === 'auth.err.sameAsOld',
    `Das alte Passwort wird als neues angenommen (${gleich.status})`);

  const gut = await hole('/api/auth/change', alsJson({ password: ERST, newPassword: NEU }));
  check(gut.status === 200 && gut.body.mustChange === false, `Wechsel schlägt fehl (${gut.status})`);
  check(!getUser('captain').mustChange, 'Die Datei kennt den Wechsel nicht');
  check(!await verifyUser('captain', ERST), 'Das erste Passwort gilt weiter');
  check(await verifyUser('captain', NEU), 'Das neue Passwort gilt nicht');
  console.log('Passwortwechsel: altes Passwort nötig, zu kurzes und gleiches abgewiesen.');
}

// --- Jetzt ins Spiel
{
  const wurzel = await hole('/', { headers: seite });
  check(wurzel.status === 200, `Der Client kommt nicht heraus (${wurzel.status})`);
  check(await wsVersuch() === 'hello', 'Mit Sitzung kommt keine WebSocket zustande');
  const anmeldeseite = await hole('/login.html', { headers: seite });
  check(anmeldeseite.status === 302 && anmeldeseite.ort === './',
    'Angemeldet landet man wieder auf der Anmeldeseite');
  console.log('Mit gewechseltem Passwort: Client und WebSocket stehen offen.');
}

// --- Mit Anmeldung heisst man wie sein Konto - egal, was der Client schickt
{
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie: keks } });
  let lobby = null;
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'hello') ws.send(JSON.stringify({ t: 'create', name: 'Hochstapler' }));
    if (m.t === 'lobby') lobby = m.lobby;
  });
  for (let i = 0; i < 40 && !lobby; i++) await wait(50);
  const ich = () => lobby?.players[0]?.name;
  check(ich() === 'captain', `Spielername ist '${ich()}' statt des Kontonamens`);
  lobby = null;
  ws.send(JSON.stringify({ t: 'setName', name: 'Hochstapler' }));
  ws.send(JSON.stringify({ t: 'addBot' }));      // loest eine neue Lobbysicht aus
  for (let i = 0; i < 40 && !lobby; i++) await wait(50);
  check(ich() === 'captain', `setName hat den Kontonamen ueberschrieben ('${ich()}')`);
  ws.close();
  console.log('Spielername: kommt aus dem Konto, weder create noch setName ändern ihn.');
}

// --- Ein gelöschtes Konto fliegt sofort, auch aus einer offenen Sitzung
{
  const offen = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { cookie: keks } });
  let zu = false;
  offen.on('close', () => { zu = true; });
  await new Promise(r => offen.on('message', r));

  deleteUser('captain');
  const wurzel = await hole('/', { headers: seite });
  check(wurzel.status === 302, `Gelöschtes Konto kommt noch an den Client (${wurzel.status})`);
  for (let i = 0; i < 40 && !zu; i++) await wait(100);
  check(zu, 'Die offene WebSocket des gelöschten Kontos bleibt stehen');
  try { offen.close(); } catch { /* egal */ }
  console.log('Gelöschtes Konto: HTTP sofort zu, offene WebSocket binnen einer Sekunde getrennt.');
}

// --- Eine unlesbare Kontendatei sperrt aus, bringt den Server aber nicht um.
//     Sie wird in jeder Anfrage gelesen - ein Wurf dort reichte bis in den
//     HTTP-Server und haette ihn bei jedem Aufruf abgeworfen.
{
  const heil = fs.readFileSync(USERS, 'utf8');
  fs.writeFileSync(USERS, '{ das ist kein JSON');
  const wurzel = await hole('/', { headers: seite });
  check(wurzel.status === 302, `Unlesbare Kontendatei laesst durch (${wurzel.status})`);
  const anmeldeseite = await hole('/login.html', { headers: seite });
  check(anmeldeseite.status === 200, 'Nach einer unlesbaren Kontendatei antwortet der Server nicht mehr');
  fs.writeFileSync(USERS, heil);
  const wieder = await hole('/login.html', { headers: seite });
  check(wieder.status === 200, 'Der Server erholt sich nicht, wenn die Datei wieder heil ist');
  console.log('Unlesbare Kontendatei: sperrt aus, wirft den Server aber nicht ab.');
}

// --- Rateversuche bremsen. Zum Schluss, weil die Sperre nach Herkunft zählt.
{
  const r = await addUser('opfer', 'einPasswortX1');
  check(r.name === 'opfer', 'Konto für den Rateversuch fehlt');
  keks = null;
  let gesperrt = null;
  for (let i = 0; i < 8 && !gesperrt; i++) {
    const a = await hole('/api/auth/login', alsJson({ user: 'opfer', password: 'daneben' + i }));
    if (a.status === 429) gesperrt = { nach: i + 1, body: a.body };
  }
  check(gesperrt, 'Beliebig viele Fehlversuche bleiben ohne Folgen');
  check(gesperrt && gesperrt.body.error === 'auth.err.locked' && gesperrt.body.params?.n > 0,
    'Die Sperre nennt keine Wartezeit');
  const trotzdem = await hole('/api/auth/login', alsJson({ user: 'opfer', password: 'einPasswortX1' }));
  check(trotzdem.status === 429, 'Während der Sperre kommt das richtige Passwort durch');
  console.log(`Rateversuche: nach ${gesperrt?.nach} Fehlversuchen gesperrt, auch für das richtige Passwort.`);
}

// --- Abgeschaltet ist abgeschaltet: dann soll nichts im Weg stehen
{
  server.kill();
  await wait(200);
  const PORT2 = PORT + 1;
  const offen = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT2), HO_AUTH: 'off' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise(r => offen.stdout.once('data', r));
  const r = await fetch(`http://127.0.0.1:${PORT2}/`, { redirect: 'manual' });
  check(r.status === 200, `Ohne Anmeldung kommt der Client nicht heraus (${r.status})`);
  const ws = await new Promise((ok) => {
    const s = new WebSocket(`ws://127.0.0.1:${PORT2}`);
    s.on('message', (raw) => { ok(JSON.parse(raw.toString()).t); s.close(); });
    s.on('error', () => ok('fehler'));
    setTimeout(() => ok('still'), 3000);
  });
  check(ws === 'hello', `Ohne Anmeldung kommt keine WebSocket zustande (${ws})`);
  offen.kill();
  console.log('HO_AUTH=off: alles offen wie vorher - für Entwicklung und Tests.');
}

fs.rmSync(dir, { recursive: true, force: true });
if (fehler) { console.error(`\n${fehler} Probleme am Zugang.`); process.exit(1); }
console.log('\nAlle Zugangsprüfungen bestanden.');
process.exit(0);
