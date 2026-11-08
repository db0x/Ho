// The crew's answers (client/js/audio/crew.js): what an order means (attack,
// colonize, move), every fleet keeps its voice, answers come right away or not
// at all, picking a fleet only sometimes and not the same one again soon, no
// line twice in a short while - and only with the radio on "All". And there
// are plenty of lines for every kind (server/radio/lines.json). Also the AI's
// lines on this side: as text without sound, played again on request.
process.env.HO_TTS = 'http://127.0.0.1:9';
// The browser code imports ../../shared/ - the server serves that from shared/
// at the root, so here as well (client/shared/ does not exist).
const { register } = await import('node:module');
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('.') && ctx.parentURL) {
      const url = new URL(spec, ctx.parentURL);
      if (url.pathname.includes('/client/shared/')) {
        return { url: url.href.replace('/client/shared/', '/shared/'), shortCircuit: true };
      }
    }
    return next(spec, ctx);
  }`));
const { radioManifest } = await import('../server/radio/index.js');
const { radio } = await import('../client/js/audio/radio.js');
const { sfx } = await import('../client/js/audio/sfx.js');
const { crewSay, orderKind, hasColonists } = await import('../client/js/audio/crew.js');

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } };

// ------------------------------------------------------------- lines
const m = radioManifest();
const voices = Object.keys(m).filter(s => /^crew\d+$/.test(s));
assert(voices.length >= 4, `four crew voices or more (${voices.length})`);
const KINDS = { select: 15, selectColony: 8, move: 15, attack: 15, colonize: 10, chase: 8, hole: 6 };
for (const [kind, least] of Object.entries(KINDS)) {
  assert(m.crew1[kind]?.length >= least, `crew: at least ${least} lines for ${kind} (${m.crew1[kind]?.length})`);
  assert(voices.every(v => m[v][kind]?.length === m.crew1[kind].length), `every voice speaks every ${kind} line`);
}
assert(new Set(voices.map(v => m[v].select[0].voice)).size === voices.length, 'every crew voice its own');

// --------------------------------------------------------- order kinds
const view = {
  you: 'me',
  planets: { 1: { owner: 'me' }, 2: { owner: null }, 3: { owner: 'foe' }, 4: { owner: 'friend' } },
  diplomacy: { alliances: [{ a: 'friend', b: 'me' }] }
};
const fighters = { id: 'f1', ships: [{ type: 'fighter' }] };
const settlers = { id: 'f2', ships: [{ type: 'fighter' }, { type: 'colony', colonists: 1 }] };
assert(orderKind(view, fighters, 3) === 'attack', 'a foreign planet: attack');
assert(orderKind(view, fighters, 4) === 'move', 'an ally\'s planet: move');
assert(orderKind(view, fighters, 1) === 'move', 'an own planet: move');
assert(orderKind(view, fighters, 2) === 'move', 'a free planet without colonists: move');
assert(orderKind(view, settlers, 2) === 'colonize', 'a free planet with colonists: colonize');
assert(orderKind(view, settlers, 3) === 'attack', 'colonists towards a foreign planet: attack');
assert(hasColonists(settlers) && !hasColonists(fighters), 'colonists recognised');

// ------------------------------------------------------------ answers
// The radio without sound: it takes what it is given, unless it is busy.
const list = {};
for (const [s, ev] of Object.entries(m)) {
  list[s] = Object.fromEntries(Object.entries(ev).map(([e, c]) => [e, c.map(x => ({ file: x.file, text: x.text, v: x.key }))]));
}
radio.manifest = Promise.resolve(list);
sfx.on = true;
const played = [];
let busy = false;
radio.instant = (item) => { if (busy) return false; played.push(item); return true; };
radio.level = 'all';
let now = 1_000_000;
Date.now = () => now;
const random = Math.random;
Math.random = () => 0;                       // every chance comes true

assert(await crewSay('attack', fighters), 'an order: answered');
assert(played[0].speaker.startsWith('crew') && played[0].short, 'by the crew, as a short call');
assert(!(await crewSay('attack', fighters)), 'right after: quiet');
now += 2500;
assert(await crewSay('attack', fighters), 'a little later: again');
assert(played[1].speaker === played[0].speaker, 'the same fleet, the same voice');
assert(played[1].clip.file !== played[0].clip.file, 'not the same line again');
// Different fleets spread over the voices.
const used = new Set();
for (let i = 0; i < 40; i++) {
  now += 3000;
  await crewSay('move', { id: 'fleet' + i, ships: [] });
  used.add(played[played.length - 1].speaker);
}
assert(used.size >= 3, `fleets spread over the voices (${[...used].join(', ')})`);
// No line twice among the last ones.
const seen = [];
for (let i = 0; i < 6; i++) { now += 3000; await crewSay('move', fighters); seen.push(played[played.length - 1].clip.file); }
assert(new Set(seen).size === seen.length, 'six answers, six different lines');
// Picking: the same fleet again soon stays quiet; another one may answer.
now += 10000;
assert(await crewSay('select', fighters), 'picked: answered');
now += 7000;
assert(!(await crewSay('select', fighters)), 'the same fleet picked again soon: quiet');
assert(await crewSay('select', settlers), 'another fleet: answered');
// The radio busy: dropped, not saved up.
now += 10000;
busy = true;
assert(!(await crewSay('attack', fighters)), 'radio busy: no answer');
busy = false;
// Bad luck, radio on "important" or off: nothing.
now += 10000;
Math.random = () => 0.999;
assert(!(await crewSay('select', { id: 'x', ships: [] })), 'by chance: quiet');
Math.random = () => 0;
radio.level = 'important';
assert(!(await crewSay('attack', fighters)), 'radio on "important": no crew');
radio.level = 'off';
assert(!(await crewSay('attack', fighters)), 'radio off: no crew');
Math.random = random;

// ----------------------------------------- the AI's lines on this side
// Without sound (no speech service, or the sound off here) a long line still
// comes as text; a short call does not. A spoken one can be played again.
{
  const shown = [], queued = [];
  radio.onLine(item => shown.push(item));
  const push = radio.push;
  radio.push = item => queued.push(item);
  radio.level = 'all';
  sfx.on = true;
  radio.receive({ speaker: 'raider', from: 'p2', name: 'Lady Solderpot', text: 'Hey, Olena!', important: true, textOnly: true });
  assert(shown.length === 1 && shown[0].textOnly && shown[0].clip.text === 'Hey, Olena!' && !queued.length,
    'no file: shown as text right away, nothing played');
  radio.receive({ speaker: 'raider', from: 'p2', text: 'Jackpot!', short: true });
  assert(shown.length === 1 && !queued.length, 'a short call without sound: left out');
  radio.receive({ speaker: 'raider', from: 'p2', name: 'L', text: 'Ha!', file: 'tts/0123456789abcdef0123.mp3', v: 'x', important: false });
  assert(queued.length === 1 && shown.length === 1, 'with a file: played (the subtitle comes when it is spoken)');
  sfx.on = false;
  radio.receive({ speaker: 'raider', from: 'p2', name: 'L', text: 'Ha!', file: 'tts/0123456789abcdef0123.mp3', v: 'x', important: true });
  assert(shown.length === 2 && !shown[1].textOnly && shown[1].clip.file && queued.length === 1,
    'sound off here: as text, but it keeps its file - to be played again later');
  sfx.on = true;
  radio.level = 'important';
  radio.receive({ speaker: 'raider', from: 'p2', text: 'Minor', important: false });
  assert(shown.length === 2, 'radio on "important": an unimportant line not even as text');
  radio.level = 'off';
  radio.receive({ speaker: 'raider', from: 'p2', text: 'Big', important: true });
  assert(shown.length === 2, 'radio off: nothing, not even text');
  radio.level = 'all';
  assert(radio.replay(shown[1]) && queued[1].replay && queued[1].clip.file === shown[1].clip.file, 'played again on request');
  assert(!radio.replay(shown[0]), 'a line without sound cannot be played again');
  radio.push = push;
}

// ------------------------------------- after the battle on the map
// A line about a battle waits until that battle has played out; the battle
// animation knows when (BattleFx.moment).
{
  const { BattleFx } = await import('../client/js/render/battlefx.js');
  const battle = { sides: ['me', 'p2'], units: [[0, 'fighter', 5, 5], [1, 'fighter', 5, 5]],
    rounds: [[[0, 1, 2], [1, 0, 2]], [[0, 1, 3]]], scuttled: [], fled: [] };
  const fx = new BattleFx();
  const t0 = performance.now();
  fx.start([{ planetId: 7, at: null, battle }, { planetId: 2, at: { x: 5, y: 6, z: 0 }, battle }], 'me', t0);
  const start = fx.moment({ planetId: 7 }, 'start'), end = fx.moment({ planetId: 7 }, 'end');
  assert(start != null && end > start, `a battle on the map has a start and an end (${start} - ${end})`);
  assert(fx.moment({ planetId: 2, at: { x: 5, y: 6, z: 0 } }, 'start') > start, 'the second battle starts a little later');
  assert(fx.moment({ planetId: 2 }) === null && fx.moment({ planetId: 9 }) === null, 'another place: no battle playing there');

  const shown = [];
  const off = radio.onLine(item => shown.push(item));
  radio.level = 'all';
  radio.moment = (where, when) => fx.moment(where, when);
  radio.receive({ speaker: 'raider', from: 'p2', name: 'L', text: 'Your planet is mine.', important: true, textOnly: true, where: { planetId: 7, when: 'end' } });
  radio.receive({ speaker: 'raider', from: 'p2', name: 'L', text: 'We are allies.', important: true, textOnly: true });
  assert(shown.length === 1 && shown[0].clip.text === 'We are allies.', 'no battle: right away; about a battle: not yet');
  await new Promise(r => setTimeout(r, Math.max(0, end - performance.now()) + 700));
  assert(shown.length === 2 && shown[1].clip.text === 'Your planet is mine.', 'after the battle has played out: there');
  radio.receive({ speaker: 'raider', from: 'p2', name: 'L', text: 'Too late.', important: true, textOnly: true, where: { planetId: 7, when: 'end' } });
  assert(shown.length === 3, 'the battle already over: right away');
  off();
  radio.moment = () => null;
}

const total = Object.keys(KINDS).reduce((a, k) => a + m.crew1[k].length, 0);
if (errors) { console.error(`${errors} error(s).`); process.exit(1); }
console.log(`Crew: ${total} lines in ${voices.length} voices - answers right away or not at all, never the same line twice in a row.`);
