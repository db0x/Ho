// Radio chatter (server/radio/chatter.js): read off the turn's log, sparse
// on purpose - only what concerns the listener, one line per turn at most,
// the most important wins, a speaker keeps quiet for a few turns, never the
// same line twice in a row, switched off in the lobby means silence. And
// every speaker has lines for every event (server/radio/lines.json).
// The speech service is not needed here: the chatter only picks the lines
// (which are spoken is test/tts.js) - it just has to be configured.
process.env.HO_TTS = 'http://127.0.0.1:9';
const { createGame, startGame } = await import('../server/game/game.js');
const { addPlayer } = await import('../server/game/players.js');
const { resolveTurn } = await import('../server/game/turn.js');
const { runBot } = await import('../server/ai/bot.js');
const { radioTurn, RADIO_EVENTS, RADIO_QUIET_TURNS, RADIO_CALLS } = await import('../server/radio/chatter.js');
const { radioManifest, radioVoices } = await import('../server/radio/index.js');
const { AI_PERSONAS, ALIEN_ID } = await import('../shared/rules.js');

let errors = 0;
const assert = (ok, msg) => { if (!ok) { console.error('ERROR: ' + msg); errors++; } };
const always = () => 0;        // every chance comes true, the first variant
const never = () => 0.999;     // only what is certain
// The long line and the short call of a listener in a turn's result.
const lineOf = (out, id) => out.get(id)?.find(m => !m.short);
const callOf = (out, id) => out.get(id)?.find(m => m.short);
// Is this message one of the lines of that speaker and event?
const is = (m, speaker, event) => !!m && (radioManifest()[speaker]?.[event] || []).some(c => c.file === m.file);

// ---------------------------------------------------------------- lines
const clips = radioManifest();
for (const persona of AI_PERSONAS) {
  for (const ev of ['war', 'attack', 'defeat', 'victory', 'ally', 'betray', 'engage', 'win', 'lose']) {
    assert(clips[persona]?.[ev]?.length >= 2, `${persona} has lines for ${ev}`);
  }
  for (const ev of ['war', 'attack', 'defeat', 'victory', 'ally', 'betray']) {
    assert(radioVoices()[persona]?.templates?.[ev]?.length >= 2, `${persona} has templates for ${ev}`);
  }
}
for (const ev of ['appear', 'attack', 'defeat', 'engage', 'lose']) assert(clips.alien?.[ev]?.length >= 2, `aliens have lines for ${ev}`);
let files = 0;
const keys = new Set();
for (const events of Object.values(clips)) for (const list of Object.values(events)) for (const c of list) {
  files++;
  keys.add(c.key);
  assert(/^[0-9a-f]{20}$/.test(c.key) && c.file === `tts/${c.key}.mp3` && c.say && c.text && c.voice, `line complete: ${c.say}`);
  assert(c.say.length <= 120, `short enough to speak: ${c.say}`);
}
assert(keys.size === files, 'every line its own key');
const PLACEHOLDERS = new Set(['name', 'player', 'planet', 'ship']);
for (const [sp, v] of Object.entries(radioVoices())) {
  for (const list of Object.values(v.templates || {})) for (const tpl of list) {
    for (const [, k] of tpl.matchAll(/\{(\w+)\}/g)) assert(PLACEHOLDERS.has(k), `${sp}: known placeholder {${k}} in "${tpl}"`);
  }
}

// ---------------------------------------------------------------- rules
function setup() {
  const g = createGame('Radio');
  g.settings.seed = 7;
  g.settings.wormholes = false;
  addPlayer(g, { name: 'Hu' });
  addPlayer(g, { name: 'Con', isBot: true, persona: 'conqueror' });
  addPlayer(g, { name: 'Vul', isBot: true, persona: 'vulture' });
  startGame(g);
  const [h, con, vul] = g.players;
  return { g, h, con, vul, home: g.galaxy.planets[h.homeworld] };
}
const battle = (planet, sides) => ({
  type: 'combat', planetId: planet.id, playerIds: sides.map(s => s[0]),
  key: 'log.battle', params: { planet: planet.name, sides: sides.map(([id, left]) => ({ name: id, left, before: 5 })) }
});

{
  const { g, h, con, home } = setup();
  // First battle against an AI colony: it declares itself.
  let out = radioTurn(g, [battle(home, [[con.id, 3], [h.id, 2]])], always);
  let m = lineOf(out, h.id);
  assert(m?.speaker === 'conqueror' && is(m, 'conqueror', 'war'), `first battle: war line (${m?.file})`);
  assert(m.important === true && m.from === con.id && m.name === 'Con', 'war line important, with sender');
  assert(m.where?.planetId === home.id && m.where.when === 'end', `about a battle: after it on the map (${JSON.stringify(m.where)})`);
  assert(!out.has(con.id), 'the AI itself gets nothing');
  // Next turn: the conqueror keeps quiet towards this player.
  g.turn++;
  out = radioTurn(g, [battle(home, [[con.id, 3], [h.id, 2]])], always);
  assert(!lineOf(out, h.id), 'speaker keeps quiet right after');
  g.turn += RADIO_QUIET_TURNS;
  out = radioTurn(g, [battle(home, [[con.id, 3], [h.id, 2]])], always);
  m = lineOf(out, h.id);
  assert(is(m, 'conqueror', 'attack') && m.important === false, `later: attack line (${m?.file})`);
  // Attacks only sometimes.
  g.turn += RADIO_QUIET_TURNS;
  out = radioTurn(g, [battle(home, [[con.id, 3], [h.id, 2]])], never);
  assert(!lineOf(out, h.id), `attack is chance (${RADIO_EVENTS.attack.chance}) - not with bad luck`);
  // Never the same clip twice in a row.
  let prev = g.radio.lastFile[h.id];
  for (let i = 0; i < 6; i++) {
    g.turn += RADIO_QUIET_TURNS;
    m = lineOf(radioTurn(g, [battle(home, [[con.id, 3], [h.id, 2]])], always), h.id);
    assert(m && m.file !== prev, `no repeat (${prev} -> ${m?.file})`);
    prev = m?.file;
  }
}

{
  const { g, h, con, vul, home } = setup();
  // Several things at once: the aliens appearing beat everything else.
  const out = radioTurn(g, [
    battle(home, [[con.id, 3], [h.id, 2]]),
    { type: 'alien', playerIds: [h.id], planetId: home.id, key: 'log.alienRift', params: {} },
    { type: 'diplomacy', key: 'log.alliance', params: { a: vul.name, b: h.name } }
  ], always);
  const m = lineOf(out, h.id);
  assert(out.size === 1 && m?.speaker === 'alien' && is(m, 'alien', 'appear'), `aliens first (${m?.file})`);
  assert(m.where?.planetId === home.id, 'the aliens\' planet goes along - to jump there from the comms');
  assert(m.from === ALIEN_ID && m.name === null, 'aliens without a name');
}

{
  const { g, h, con, vul, home } = setup();
  // Alliance and notice, by the names in the log.
  let m = lineOf(radioTurn(g, [{ type: 'diplomacy', key: 'log.alliance', params: { a: vul.name, b: h.name } }], always), h.id);
  assert(is(m, 'vulture', 'ally'), `alliance: ally line (${m?.file})`);
  assert(!m.where, 'an alliance is no battle: right away');
  g.turn += RADIO_QUIET_TURNS;
  m = lineOf(radioTurn(g, [{ type: 'diplomacy', key: 'log.allianceNotice', params: { player: vul.name, other: h.name, n: 3 } }], always), h.id);
  assert(is(m, 'vulture', 'betray') && m.important, `notice: betray line (${m?.file})`);
  // An alliance between two AI colonies concerns no one here.
  g.turn += RADIO_QUIET_TURNS;
  assert(!radioTurn(g, [{ type: 'diplomacy', key: 'log.alliance', params: { a: vul.name, b: con.name } }], always).size,
    'AI with AI: silence');
  // The conqueror takes a planet: victory; loses one to the player: defeat.
  m = lineOf(radioTurn(g, [{ type: 'invade', playerIds: [con.id, h.id], planetId: home.id, key: 'log.invadeFrom', params: {} }], always), h.id);
  assert(is(m, 'conqueror', 'victory'), `invasion by the AI: victory line (${m?.file})`);
  g.turn += RADIO_QUIET_TURNS;
  m = lineOf(radioTurn(g, [{ type: 'invade', playerIds: [h.id, con.id], planetId: home.id, key: 'log.invadeFrom', params: {} }], always), h.id);
  assert(is(m, 'conqueror', 'defeat'), `invasion by the player: defeat line (${m?.file})`);
  // Aliens wiped out in a battle with the player.
  m = lineOf(radioTurn(g, [battle(home, [[ALIEN_ID, 0], [h.id, 4]])], always), h.id);
  assert(is(m, 'alien', 'defeat'), `aliens beaten (${m?.file})`);
  // Switched off in the lobby: silence.
  g.settings.radio = false;
  g.turn += RADIO_QUIET_TURNS;
  assert(!radioTurn(g, [{ type: 'alien', playerIds: [h.id], key: 'log.alienRift', params: {} }], always).size, 'radio off: silence');
}

{
  const { g, h, con, vul, home } = setup();
  // A battle: the long line, and a short call besides - but not from the same speaker.
  let out = radioTurn(g, [battle(home, [[con.id, 3], [h.id, 2]])], always);
  assert(lineOf(out, h.id)?.from === con.id && !callOf(out, h.id), 'one speaker: line, no call on top');
  // Both colonies spoke a long line just now - only calls are left.
  g.radio.last[h.id][vul.id] = g.turn;
  out = radioTurn(g, [battle(home, [[con.id, 3], [vul.id, 0], [h.id, 2]])], () => 0.5);
  assert(!lineOf(out, h.id), 'no long line while both keep quiet');
  const c = callOf(out, h.id);
  assert(c && c.short && !c.important, `a short call (${c?.file})`);
  assert(c?.where?.planetId === home.id && c.where.when === 'end', 'a losing shout: at the end of the battle');
  // The worse it goes, the likelier the call: the vulture lost everything.
  assert(is(c, 'vulture', 'lose'), `the beaten one shouts (${c?.file})`);
  // Calls pause a turn only.
  g.turn++;
  const again = callOf(radioTurn(g, [battle(home, [[vul.id, 2], [h.id, 0]])], always), h.id);
  assert(is(again, 'vulture', 'win'), `a turn later: a call again (${again?.file})`);
  // The aliens shout too.
  g.turn++;
  const a = callOf(radioTurn(g, [battle(home, [[ALIEN_ID, 5], [h.id, 1]]), battle(home, [[con.id, 1], [h.id, 1]])], always), h.id);
  assert(a, 'aliens or colony shout in a battle');
  assert(a?.where?.when === 'start', `"Open fire!": at the start of the battle (${JSON.stringify(a?.where)})`);
  assert(RADIO_CALLS['call.lose'].chance > RADIO_CALLS['call.engage'].chance, 'losing shouts more than engaging');
}

// ------------------------------------------------- a whole game: how much
{
  const g = createGame('Radio game');
  g.settings.seed = 11;
  g.settings.planetsPerPlayer = 4;
  addPlayer(g, { name: 'Hu' });
  for (const persona of ['conqueror', 'raider', 'vulture']) addPlayer(g, { isBot: true, persona });
  startGame(g);
  const h = g.players[0];
  let lines = 0, calls = 0, turns = 0;
  for (; turns < 120 && g.state === 'running'; turns++) {
    h.ready = true;
    for (const bot of g.players.filter(p => p.isBot && p.alive)) runBot(g, bot);
    const out = radioTurn(g, resolveTurn(g));
    assert(out.size <= 1, 'one listener');
    for (const msgs of out.values()) {
      assert(msgs.filter(m => !m.short).length <= 1 && msgs.filter(m => m.short).length <= 1, 'a line and a call at most');
      lines += msgs.filter(m => !m.short).length;
      calls += msgs.filter(m => m.short).length;
      for (const m of msgs) assert(clips[m.speaker] && m.file && m.v && m.text && m.line?.say, 'complete message');
    }
  }
  console.log(`A game of ${turns} turns against three AI colonies: ${lines} radio lines, ${calls} short calls.`);
  assert(lines <= turns / 2, 'not more than one line every other turn');
}

console.log(`${files} lines checked.`);
if (errors) { console.error(`${errors} error(s).`); process.exit(1); }
console.log('Radio chatter: sparse, to the point, never twice the same.');
