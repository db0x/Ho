// Your own fleets answer over the radio, short and snappy: when you pick one
// ("Yes?"), send it off ("On it."), into battle ("Charge!"), to settle
// ("New home!"), after a foreign fleet ("After 'em!") or into a wormhole.
//
// Many lines and four voices - every fleet keeps its voice, so you get to
// know your fleets by ear. Kept from getting tiring on purpose:
//   - an answer comes right away or not at all, it never waits in line
//   - picking a fleet only sometimes gets an answer, and not the same fleet
//     again soon; orders nearly always, but not in quick succession
//   - the lines just heard are not repeated
//   - only with the radio on "All" (radio.level), and never over a person
//     on the CB radio
// The lines are in server/radio/lines.json (speaker crew), spoken by the
// speech service like all the radio chatter.
//
// The shipyard of an own planet answers too when the planet is picked -
// with its name ("Kepler Prime shipyard ready."), so the server has it
// spoken (yardSay); an answer that comes too late is dropped.
import { radio } from './radio.js';

/** How often and how far apart: chance, and the least time since the last answer of that kind. */
const RULES = {
  select:       { chance: 0.6, gap: 4000 },
  selectColony: { chance: 0.7, gap: 4000 },
  move:         { chance: 0.8, gap: 1500 },
  attack:       { chance: 0.9, gap: 2000 },
  colonize:     { chance: 0.9, gap: 2000 },
  chase:        { chance: 0.9, gap: 2000 },
  hole:         { chance: 0.9, gap: 2000 }
};
// The same fleet picked again within this time stays quiet.
const SAME_FLEET_MS = 12000;
// The shipyard: as often as picking a fleet, the same planet not again soon.
const YARD = { chance: 0.6, gap: 4000 };
// A shipyard's answer later than this after the click is no answer any more.
const YARD_ANSWER_MS = 3000;
// How many of the last lines are not repeated (per kind).
const MEMORY = 6;

const last = new Map();          // kind -> time of the last answer
const recent = new Map();        // kind -> files heard lately
const picked = new Map();        // fleet id -> when it last answered to being picked
let lastAny = 0;
let ask = 0, asked = null;       // the shipyard's pending question: {ask, at}
let request = null;              // (msg) => sends to the server - set by main.js

/** The voice of a fleet: the same one for as long as the fleet lives. */
function voiceOf(fleetId, voices) {
  let h = 0;
  for (const ch of String(fleetId)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return voices[Math.abs(h) % voices.length];
}

/**
 * A fleet answers - maybe.
 * @param {'select'|'selectColony'|'move'|'attack'|'colonize'|'chase'|'hole'} kind
 * @param {{id: string}} fleet
 */
export async function crewSay(kind, fleet) {
  const rule = RULES[kind];
  if (!rule || !fleet || radio.level !== 'all') return false;
  const now = Date.now();
  const picking = kind.startsWith('select');
  if (now - (last.get(kind) ?? 0) < rule.gap || now - lastAny < 800) return false;
  if (picking && now - (picked.get(fleet.id) ?? 0) < SAME_FLEET_MS) return false;
  if (Math.random() >= rule.chance) return false;
  const m = await radio.load();
  const voices = Object.keys(m).filter(s => /^crew\d+$/.test(s) && m[s][kind]?.length).sort();
  if (!voices.length) return false;
  const speaker = voiceOf(fleet.id, voices);
  const heard = recent.get(kind) ?? [];
  const lines = m[speaker][kind];
  const fresh = lines.filter((_, i) => !heard.includes(i));
  const pool = fresh.length ? fresh : lines;
  const clip = pool[Math.floor(Math.random() * pool.length)];
  if (!radio.instant({ speaker, clip, from: null, name: null, short: true, crew: true })) return false;
  last.set(kind, now);
  lastAny = now;
  if (picking) picked.set(fleet.id, now);
  recent.set(kind, [...heard, lines.indexOf(clip)].slice(-MEMORY));
  return true;
}

/** How a shipyard question gets to the server. */
export function setCrewRequest(fn) { request = fn; }

/**
 * An own planet with a shipyard is picked: maybe its yard answers, by name.
 * Asks the server, which has the line spoken; the answer comes as crewReply.
 */
export function yardSay(planetId) {
  if (!request || radio.level !== 'all' || !Number.isInteger(planetId)) return false;
  const now = Date.now();
  const key = 'planet:' + planetId;
  if (now - (last.get('yard') ?? 0) < YARD.gap || now - lastAny < 800) return false;
  if (now - (picked.get(key) ?? 0) < SAME_FLEET_MS) return false;
  if (Math.random() >= YARD.chance) return false;
  last.set('yard', now);
  picked.set(key, now);
  asked = { ask: ++ask, at: now };
  request({ t: 'radioLine', kind: 'yard', planetId, ask });
  return true;
}

/** The server's answer to a click (a radio message with crew: true) - played if still in time. */
export function crewReply(m) {
  if (!asked || m.ask !== asked.ask || Date.now() - asked.at > YARD_ANSWER_MS || !m.file) return false;
  asked = null;
  if (!radio.instant({ speaker: m.speaker, clip: { file: m.file, v: m.v, text: m.text }, from: null, name: null, short: true, crew: true })) return false;
  lastAny = Date.now();
  return true;
}

/**
 * What an order to this planet means for the fleet: attack (a foreign,
 * hostile planet), colonize (a free one, with colonists aboard) or move.
 */
export function orderKind(view, fleet, planetId) {
  const planet = view?.planets?.[planetId];
  if (!planet || !fleet) return 'move';
  const you = view.you;
  if (planet.owner != null && planet.owner !== you) {
    const allied = (view.diplomacy?.alliances || []).some(x =>
      (x.a === you && x.b === planet.owner) || (x.b === you && x.a === planet.owner));
    return allied ? 'move' : 'attack';
  }
  if (planet.owner == null && hasColonists(fleet)) return 'colonize';
  return 'move';
}

export const hasColonists = fleet => (fleet?.ships || []).some(s => s.type === 'colony' || s.colonists > 0);
