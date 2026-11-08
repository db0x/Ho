// Radio lines a player's own click asks for: the shipyard of an own planet
// answering when it is picked ("Kepler Prime shipyard ready."). The name is
// in it, so the speech service speaks it on demand (cached after the first
// time). An answer to a click comes quickly or not at all: when the line with
// the name takes too long, the fixed line without it; when that fails too,
// nothing.
import { yardLine } from '../radio/chatter.js';
import { speak } from '../radio/tts.js';
import { send } from './connections.js';

// How long a click's answer may take to be spoken.
const ANSWER_MS = 2500;
// Clicks closer together than this get no second answer.
const GAP_MS = 1200;

const within = (promise, ms) => Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new Error('slow')), ms).unref?.())]);

/** The message with a spoken clip - the name if it can be had in time, else the fixed line, else null. */
async function spoken({ named, line, ...msg }) {
  if (named) {
    try { return { ...msg, ...(await within(speak(named.say, named.voice, named.speed), ANSWER_MS)), text: named.text }; } catch {}
  }
  try { return { ...msg, ...(await within(speak(line.say, line.voice, line.speed), ANSWER_MS)) }; } catch { return null; }
}

export const radioHandlers = {
  radioLine({ c, ws, game, me }, msg) {
    if (!game || game.state !== 'running' || !me || game.settings.radio === false) return;
    if (msg.kind !== 'yard' || !Number.isInteger(msg.planetId)) return;
    const now = Date.now();
    if (now - (c.radioLineAt || 0) < GAP_MS) return;
    c.radioLineAt = now;
    const line = yardLine(game, me, msg.planetId);
    if (!line) return;
    spoken(line).then((m) => { if (m) send(ws, { ...m, ask: Number(msg.ask) || 0 }); }, () => {});
  }
};
