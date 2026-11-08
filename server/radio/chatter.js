// Who says what over the radio after a turn. Read off the turn's log - the
// battles, invasions, alliances and alien sightings - so no rule of the game
// needs to know about it. Sparse on purpose:
//   - only what concerns the listener: their battles, their planets, their
//     alliances, aliens they see
//   - at most one transmission per player and turn - the most important wins,
//     the rest is dropped, not saved up
//   - a speaker keeps quiet for a few turns after it spoke to someone
//   - frequent events only sometimes, rare ones always
//   - never the same clip twice in a row
// On top of that short calls ("Open fire!", "Jackpot!", "Breach!") in any
// battle with the listener - they may come more often: one per turn besides
// the long line (from another speaker), and the speaker only pauses a turn.
// Everything is spoken by the speech service (tts/): the fixed lines are
// prepared in advance, a good part of the long lines name names - the planet,
// the listener, the speaker's colony or its destroyer - and are spoken when
// needed (if that fails, the fixed line plays). Without the service the long
// lines still go out - as text on the comms (server/hub/games.js).
// The game leader can switch it off in the lobby (settings.radio); every
// player can tone it down in the browser (client/js/audio/radio.js).
import { ALIEN_ID } from '../../shared/rules.js';
import { radioManifest, radioVoices } from './index.js';
import { speakable } from './tts.js';

/**
 * The events: how important (the highest of a turn is spoken), how likely
 * (frequent ones only sometimes) and whether a player who only wants the
 * important things hears it.
 */
export const RADIO_EVENTS = {
  'alien.appear':  { prio: 100, chance: 1,    important: true },
  betray:          { prio: 90,  chance: 1,    important: true },
  war:             { prio: 85,  chance: 1,    important: true },
  victory:         { prio: 80,  chance: 0.8,  important: true },
  'alien.attack':  { prio: 70,  chance: 0.4 },
  defeat:          { prio: 60,  chance: 0.6 },
  ally:            { prio: 55,  chance: 1 },
  'alien.defeat':  { prio: 50,  chance: 0.6 },
  attack:          { prio: 40,  chance: 0.3 }
};
// Turns a speaker keeps quiet towards a player after it spoke to them.
export const RADIO_QUIET_TURNS = 3;

/** The short calls of a battle - the worse it goes for the speaker, the likelier it shouts. */
export const RADIO_CALLS = {
  'call.lose':   { prio: 3, chance: 0.8 },
  'call.win':    { prio: 2, chance: 0.7 },
  'call.engage': { prio: 1, chance: 0.6 }
};
export const RADIO_CALL_QUIET_TURNS = 1;
// How often a line names names when it can (with the speech service).
export const RADIO_NAMED_SHARE = 0.6;

/**
 * The transmissions of this turn: per human player one line at most, and
 * one short call at most.
 * @returns {Map<string, object[]>} player id -> messages for the client
 */
export function radioTurn(game, entries, rand = Math.random) {
  const out = new Map();
  if (game.settings.radio === false) return out;
  const clips = radioManifest();
  const st = game.radio ??= { met: {}, last: {}, lastFile: {} };
  st.lastCall ??= {};
  const humans = new Set(game.players.filter(p => !p.isBot && p.alive).map(p => p.id));
  if (!humans.size) return out;
  const player = id => game.players.find(p => p.id === id);
  const byName = name => game.players.find(p => p.name === name);
  const bot = id => { const p = player(id); return p?.isBot ? p : null; };

  /** @type {Map<string, {from: string, event: string}[]>} */
  const wish = new Map(), calls = new Map();
  const add = (map, listener, from, event, ctx = {}) => {
    if (!humans.has(listener)) return;
    if (!map.has(listener)) map.set(listener, []);
    map.get(listener).push({ from, event, ctx });
  };
  const want = (listener, from, event, ctx) => add(wish, listener, from, event, ctx);
  const call = (listener, from, event, ctx) => add(calls, listener, from, event, ctx);
  const planetOf = id => (id != null ? game.galaxy.planets.find(q => q.id === id) : null);
  /** A named ship (destroyer) of this owner in that orbit. */
  const shipAt = (owner, planetId) => planetId == null ? null : game.fleets
    .filter(f => f.owner === owner && f.at === planetId).flatMap(f => f.ships).find(s => s.name)?.name ?? null;

  for (const e of entries) {
    if (e.type === 'combat' && e.params?.sides) {
      // The sides of the tally follow the order of playerIds.
      const ids = e.playerIds || [];
      const left = id => e.params.sides[ids.indexOf(id)]?.left ?? 1;
      const planet = planetOf(e.planetId);
      // The battle this is about - the client lets it play out on the map first.
      const where = { planetId: e.planetId ?? null, ...(e.at ? { at: e.at } : {}) };
      for (const h of ids) {
        if (!humans.has(h)) continue;
        for (const o of ids) {
          if (o === h) continue;
          if (o === ALIEN_ID) {
            want(h, o, left(o) === 0 ? 'alien.defeat' : 'alien.attack', { where });
            call(h, o, left(o) === 0 ? 'call.lose' : 'call.engage', { where });
            continue;
          }
          if (!bot(o)) continue;
          call(h, o, left(o) === 0 ? 'call.lose' : left(h) === 0 ? 'call.win' : 'call.engage', { where });
          const ctx = { planet: planet?.name ?? e.params.near ?? null, ship: e.at ? null : shipAt(o, e.planetId), where };
          if (!st.met[`${o}>${h}`]) want(h, o, 'war', ctx);
          if (left(o) === 0) want(h, o, 'defeat', ctx);
          else if (left(h) === 0) want(h, o, 'victory', ctx);
          else if (planet?.owner === h && !e.at) want(h, o, 'attack', ctx);
        }
      }
    } else if (e.type === 'invade') {
      const [taker, loser] = e.playerIds || [];
      const name = planetOf(e.planetId)?.name ?? null;
      // After the battle over the planet, if there was one - the same place.
      const where = { planetId: e.planetId ?? null };
      if (bot(taker) && humans.has(loser)) want(loser, taker, 'victory', { planet: name, ship: shipAt(taker, e.planetId), where });
      if (bot(loser) && humans.has(taker)) want(taker, loser, 'defeat', { planet: name, where });
    } else if (e.type === 'diplomacy') {
      if (e.key === 'log.alliance' || e.key === 'log.allianceSecret') {
        const a = byName(e.params?.a), b = byName(e.params?.b);
        if (a?.isBot && b) want(b.id, a.id, 'ally');
        if (b?.isBot && a) want(a.id, b.id, 'ally');
      } else if (e.key === 'log.allianceNotice') {
        const giver = byName(e.params?.player), other = byName(e.params?.other);
        if (giver?.isBot && other) want(other.id, giver.id, 'betray');
      }
    } else if (e.type === 'alien') {
      const event = e.key === 'log.alienRift' ? 'alien.appear' : e.key === 'log.alienBrokeOff' ? 'alien.defeat' : null;
      if (event) for (const h of e.playerIds || []) want(h, ALIEN_ID, event);
    }
  }

  const choose = (h, list, rules, quiet, last) => list
    .filter(w => game.turn - (last[w.from] ?? -Infinity) >= quiet)
    .filter(w => rand() < rules[w.event].chance)
    .sort((a, b) => rules[b.event].prio - rules[a.event].prio)
    .find(w => speakerOf(game, w.from) && clipsFor(clips, game, w));
  const message = (h, pick, important, short) => {
    const options = clipsFor(clips, game, pick);
    const fresh = options.filter(c => c.file !== st.lastFile[h]);
    const clip = (fresh.length ? fresh : options)[Math.floor(rand() * (fresh.length || options.length))];
    st.lastFile[h] = clip.file;
    const speaker = speakerOf(game, pick.from);
    const msg = {
      t: 'radio', from: pick.from, name: pick.from === ALIEN_ID ? null : player(pick.from)?.name ?? null,
      speaker, file: clip.file, v: clip.key, text: clip.text,
      line: { say: clip.say, voice: clip.voice, speed: clip.speed },
      important, ...(short ? { short: true } : {})
    };
    // Tied to a battle on the map: spoken when it is over - only "Open fire!"
    // and the like at its start.
    if (pick.ctx?.where) msg.where = { ...pick.ctx.where, when: pick.event === 'call.engage' ? 'start' : 'end' };
    // Sometimes with names - the fixed clip stays as the fallback.
    if (!short) {
      const named = namedLine(radioVoices()[speaker], pick, {
        name: msg.name, player: player(h)?.name, planet: pick.ctx?.planet, ship: pick.ctx?.ship
      }, rand);
      if (named) msg.named = named;
    }
    return msg;
  };

  for (const h of humans) {
    const lines = [];
    const last = st.last[h] ??= {};
    const pick = wish.has(h) && choose(h, wish.get(h), RADIO_EVENTS, RADIO_QUIET_TURNS, last);
    if (pick) {
      last[pick.from] = game.turn;
      if (pick.event === 'war') st.met[`${pick.from}>${h}`] = true;
      lines.push(message(h, pick, !!RADIO_EVENTS[pick.event].important, false));
    }
    // A short call besides - from someone else than who just spoke.
    const lastCall = st.lastCall[h] ??= {};
    const shout = calls.has(h) && choose(h, calls.get(h).filter(w => w.from !== pick?.from),
      RADIO_CALLS, RADIO_CALL_QUIET_TURNS, lastCall);
    if (shout) {
      lastCall[shout.from] = game.turn;
      lines.push(message(h, shout, false, true));
    }
    if (lines.length) out.set(h, lines);
  }
  return out;
}

/**
 * A sentence template of this event with every name in it known, filled in -
 * once speakable for the voice (say), once as written for the subtitle
 * (text). Null when none fits, or by chance (RADIO_NAMED_SHARE).
 */
export function namedLine(voice, { event }, names, rand = Math.random, force = false) {
  const templates = voice?.templates?.[event.split('.').pop()];
  if (!templates?.length) return null;
  const say = {};
  for (const [k, v] of Object.entries(names)) { const s = speakable(v); if (s) say[k] = s; }
  const fits = templates.filter(tpl => [...tpl.matchAll(/\{(\w+)\}/g)].every(([, k]) => say[k]));
  if (!fits.length || (!force && rand() >= RADIO_NAMED_SHARE)) return null;
  const tpl = fits[Math.floor(rand() * fits.length)];
  return {
    say: tpl.replace(/\{(\w+)\}/g, (_, k) => say[k]),
    text: tpl.replace(/\{(\w+)\}/g, (_, k) => names[k]),
    voice: voice.voice, speed: voice.speed ?? 1
  };
}

/**
 * Dev mode: a line with names right away - from a random AI colony of the
 * game to this player, about one of the player's planets.
 */
export function devRadioLine(game, me, rand = Math.random) {
  const bots = game.players.filter(p => p.isBot && p.alive && radioVoices()[p.persona]?.templates);
  if (!me || !bots.length) return null;
  const bot = bots[Math.floor(rand() * bots.length)];
  const voice = radioVoices()[bot.persona];
  const own = game.galaxy.planets.filter(q => q.owner === me.id);
  const names = {
    name: bot.name, player: me.name,
    planet: (own[Math.floor(rand() * own.length)] ?? game.galaxy.planets[0])?.name,
    ship: game.fleets.filter(f => f.owner === bot.id).flatMap(f => f.ships).find(s => s.name)?.name ?? null
  };
  const events = Object.keys(voice.templates);
  for (let i = 0; i < events.length; i++) {
    const event = events[Math.floor(rand() * events.length)];
    const named = namedLine(voice, { event }, names, rand, true);
    const clip = radioManifest()[bot.persona]?.[event]?.[0];
    if (named && clip) {
      return { t: 'radio', from: bot.id, name: bot.name, speaker: bot.persona,
        file: clip.file, v: clip.key, text: clip.text, important: true, named,
        line: { say: clip.say, voice: clip.voice, speed: clip.speed } };
    }
  }
  return null;
}

/** The voice of a sender: its persona, or the aliens. */
function speakerOf(game, from) {
  if (from === ALIEN_ID) return 'alien';
  return game.players.find(p => p.id === from)?.persona ?? null;
}

function clipsFor(clips, game, { from, event }) {
  const speaker = speakerOf(game, from);
  const list = clips[speaker]?.[event.split('.').pop()];
  return list?.length ? list : null;
}
