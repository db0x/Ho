// The CB radio: voice comms between the players of a game. The server only
// knows who is on the comms and who holds the channel - the audio runs
// browser to browser.
import crypto from 'node:crypto';
import { hostOf } from '../game/game.js';
import { startStun } from '../stun.js';
import { conns, send } from './connections.js';
import { chat } from './games.js';

// CB radio (voice comms) is an option of the server: HO_VOICE=on. STUN helps
// the browsers find each other, the audio flows directly between them.
// HO_STUN_PORT=off leaves STUN out, HO_STUN_URL names the address the
// browsers should ask if it is not the page's own host.
export const VOICE = /^(on|1|true|yes)$/i.test(process.env.HO_VOICE || '');
const STUN_PORT = /^(off|0)$/i.test(process.env.HO_STUN_PORT || '') ? null : Number(process.env.HO_STUN_PORT) || 3478;
const STUN_URL = process.env.HO_STUN_URL || null;
let stunPort = null;                  // set once the socket is bound
const FLOOR_MS = 30000;               // nobody holds the channel longer
const RTC_MAX = 16 * 1024;            // one offer or answer with its candidates

/** What 'hello' says about the radio: off, or where to find STUN. */
export function voiceOffer() {
  return VOICE ? { stun: stunPort ? (STUN_URL || { port: stunPort }) : null } : null;
}

/** Binds STUN once the server listens, if the radio is on. */
export async function startVoice() {
  if (VOICE && STUN_PORT) {
    stunPort = await startStun(STUN_PORT);
    if (stunPort) console.log(`CB radio: STUN on UDP ${stunPort}${STUN_URL ? ` (announced as ${STUN_URL})` : ''}`);
  }
}

/** CB radio needs someone to talk to: at least two people in the game. */
export function voiceEligible(game) {
  return VOICE && game.state === 'running' && game.players.filter(p => !p.isBot).length >= 2;
}

/**
 * Who is on the voice comms and who holds the channel. The server only
 * knows that someone speaks, never what: the audio runs browser to browser.
 * The nonce changes with every switch-on, so the others notice a new device
 * and set up a fresh link instead of talking into the old one.
 */
export function voiceState(game) {
  return {
    t: 'voice',
    allowed: !!game.voiceAllowed,
    peers: game.players.filter(p => p.voice && p.connected).map(p => ({ id: p.id, n: p.voice.n })),
    floor: game.floor?.id ?? null
  };
}

export function broadcastVoice(game) {
  if (!VOICE) return;
  const msg = voiceState(game);
  for (const p of game.players) {
    const c = p.connId && conns.get(p.connId);
    if (c) send(c.ws, msg);
  }
}

/** Takes a player off the comms - and the channel from them if they held it. */
export function voiceDrop(game, p) {
  if (!p.voice && game.floor?.id !== p.id) return;
  p.voice = null;
  if (game.floor?.id === p.id) game.floor = null;
  broadcastVoice(game);
}

export const voiceHandlers = {
  voiceAllow({ ws, game, me }, msg) {
    // The game leader opens or closes the CB radio for everyone in the game.
    if (!game || !me || !voiceEligible(game)) return;
    if (hostOf(game) !== me) return send(ws, { t: 'error', key: 'err.voiceHostOnly' });
    game.voiceAllowed = game.settings.voice = !!msg.on;
    if (!game.voiceAllowed) {
      for (const p of game.players) p.voice = null;
      game.floor = null;
    }
    chat(game, 'System', { key: game.voiceAllowed ? 'chat.voiceOn' : 'chat.voiceOff', params: { player: me.name } });
    broadcastVoice(game);
  },

  voice({ connId, ws, game, me }, msg) {
    if (!game || !me || !voiceEligible(game)) return;
    if (msg.on && !game.voiceAllowed) return send(ws, voiceState(game));
    if (msg.on) me.voice = { n: crypto.randomBytes(6).toString('hex'), connId };
    else { me.voice = null; if (game.floor?.id === me.id) game.floor = null; }
    broadcastVoice(game);
  },

  rtc({ game, me }, msg) {
    // Connection setup between two players on the comms (offer, answer).
    // Passed on unread - but only within the game and only to someone on
    // the comms; spectators, admins included, never get any.
    if (!game || !me?.voice || !game.voiceAllowed || !voiceEligible(game)) return;
    const to = game.players.find(p => p.id === msg.to && p.voice && p !== me);
    const target = to && conns.get(to.connId);
    if (!target || JSON.stringify(msg.data ?? null).length > RTC_MAX) return;
    send(target.ws, { t: 'rtc', from: me.id, n: me.voice.n, data: msg.data });
  },

  ptt({ ws, game, me }, msg) {
    // Push to talk: one at a time, first come first served.
    if (!game || !me?.voice || !game.voiceAllowed || !voiceEligible(game)) return;
    if (msg.on) {
      if (!game.floor || game.floor.id === me.id) {
        game.floor = { id: me.id, until: Date.now() + FLOOR_MS };
        broadcastVoice(game);
      } else send(ws, voiceState(game));        // busy: tells who has the channel
    } else if (game.floor?.id === me.id) {
      game.floor = null;
      broadcastVoice(game);
    }
  }
};

/** Nobody holds the channel longer than FLOOR_MS, or after the game. */
export function releaseFloor(game, now) {
  if (game.floor && (now > game.floor.until || game.state !== 'running')) {
    game.floor = null;
    broadcastVoice(game);
  }
}
