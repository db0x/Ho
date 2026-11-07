// The crew's answers (client/js/audio/crew.js): what an order means (attack,
// colonize, move), every fleet keeps its voice, answers come right away or not
// at all, picking a fleet only sometimes and not the same one again soon, no
// line twice in a short while - and only with the radio on "All". And there
// are plenty of lines for every kind (server/radio/lines.json).
process.env.HO_TTS = 'http://127.0.0.1:9';
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

const total = Object.keys(KINDS).reduce((a, k) => a + m.crew1[k].length, 0);
if (errors) { console.error(`${errors} error(s).`); process.exit(1); }
console.log(`Crew: ${total} lines in ${voices.length} voices - answers right away or not at all, never the same line twice in a row.`);
