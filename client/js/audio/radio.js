// Radio chatter of the AI colonies and the aliens: short spoken clips (dry
// and clean, from the speech service via the server, server/radio/), fetched
// one by one when they are played, that only become radio here - squelch, carrier hiss, telephone band, crunch, drop-
// outs and a roger beep, each speaker with its own set. The aliens on top get
// a ring modulator, a warble and a swarm of copies of themselves.
//
// The server decides who says what (server/radio/chatter.js) and sends at
// most one line per turn. Here each player decides how much of it they want
// to hear (all, important only, off - kept in this browser).
//
// It plays through the sound effects' bus, so volume and mute follow them -
// a good deal quieter than the effects, it is background chatter.
// One transmission at a time; while a person talks on the CB radio it waits,
// and what has waited too long is dropped.
import { sfx } from './sfx.js';

const BASE = new URL('../../api/radio/', import.meta.url);
// Level of the chatter against the sound effects.
const LEVEL = 0.35;
// What has not been played after this long is no longer news.
const STALE_MS = 25000;
const PREF_KEY = 'ho-radio';
// After a battle has faded on the map, a breath before the line comes.
const AFTER_BATTLE_MS = 400;
// No line waits longer than this for its battle.
const MAX_WAIT_MS = 15000;
export const RADIO_LEVELS = ['all', 'important', 'off'];

/**
 * How each speaker sounds on the radio.
 * pitch    playback rate of the clip (1 = as generated)
 * band     [highpass, lowpass] in Hz - narrower sounds cheaper
 * crunch   soft clipping, 1 = clean
 * crackle  how much the signal breaks up (0..1)
 * hiss     carrier noise level under the voice
 * roger    end tones [[Hz, s], ...] (0 Hz = pause)
 * ring     ring modulator frequency (Hz) - metallic, inhuman
 * warble   pitch wobble in cents
 * swarm    extra copies at other pitches, a little late: many speak as one
 * crush    bit depth of the staircase distortion
 */
const PROFILES = {
  // Military set, clean and firm.
  conqueror:  { pitch: 0.97, band: [320, 3000], crunch: 2.5, crackle: 0.15, hiss: 0.025,
                roger: [[1250, 0.09], [950, 0.12]] },
  // Civilian band, warm and a little soft, a friendly two-tone.
  settler:    { pitch: 1, band: [260, 3200], crunch: 1.8, crackle: 0.2, hiss: 0.03,
                roger: [[880, 0.08], [1320, 0.1]] },
  // Nearly clean digital link - and a data chirp at the end.
  technocrat: { pitch: 1, band: [220, 3800], crunch: 1.3, crackle: 0.05, hiss: 0.012,
                roger: [[2000, 0.03], [2600, 0.03], [3200, 0.03], [0, 0.02], [3200, 0.05]] },
  // Cheap set, overdriven, breaking up - Morse-like chirps.
  raider:     { pitch: 1.02, band: [500, 2300], crunch: 7, crackle: 0.55, hiss: 0.05,
                roger: [[1700, 0.04], [0, 0.03], [1700, 0.04], [0, 0.03], [1700, 0.04]] },
  // Heavy, low and solid - one long, deep tone.
  bulwark:    { pitch: 0.96, band: [240, 2600], crunch: 3, crackle: 0.1, hiss: 0.03,
                roger: [[700, 0.22]] },
  // Faint, from far away: narrow, a lot of hiss and crackle.
  vulture:    { pitch: 1, band: [420, 2500], crunch: 2.5, crackle: 0.45, hiss: 0.06,
                roger: [[1100, 0.05], [0, 0.06], [1100, 0.05]] },
  // Your own crew: close by, clean, just a click at the end.
  crew:       { pitch: 1, band: [200, 4200], crunch: 1.4, crackle: 0, hiss: 0.008,
                roger: [[2600, 0.025]], squelch: 0.12 },
  // The shipyard down on the planet: a little further away, a wider hum.
  yard:       { pitch: 1, band: [240, 3600], crunch: 1.8, crackle: 0.05, hiss: 0.02,
                roger: [[1800, 0.03], [2400, 0.03]], squelch: 0.18 },
  alien:      { pitch: 0.8, band: [180, 4200], crunch: 3, crackle: 0.7, hiss: 0.06,
                ring: 52, warble: 70, swarm: [[0.93, 0.035, 0.5], [1.09, 0.06, 0.4], [0.86, 0.09, 0.3]], crush: 5,
                roger: 'chirp' },
  default:    { pitch: 1, band: [380, 2700], crunch: 3.5, crackle: 0.25, hiss: 0.035,
                roger: [[1250, 0.09], [950, 0.11]] }
};

/** A small, steady pitch offset per sender: two colonies of the same kind do not sound alike. */
function tint(from) {
  if (!from) return 1;
  let h = 0;
  for (const ch of String(from)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return 1 + ((Math.abs(h) % 9) - 4) * 0.012;
}

class Radio {
  constructor() {
    this.manifest = null;
    this.buffers = new Map();     // file -> Promise<AudioBuffer>
    this.queue = [];
    this.busy = false;
    this.listeners = new Set();   // (item) => void when a line starts - for a subtitle
    this.blocked = () => false;   // is a person talking on the CB radio?
    this.moment = () => null;     // (where, when) => when that battle starts/ends on the map, or null
    this.level = loadLevel();
  }

  /** Calls fn({speaker, clip, from, name}) whenever a transmission starts. */
  onLine(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setLevel(level) {
    if (!RADIO_LEVELS.includes(level)) return;
    this.level = level;
    try { localStorage.setItem(PREF_KEY, level); } catch {}
    if (level === 'off') this.stop();
  }

  /** The list of speakers, events and clips - only the debug dialog needs it. */
  async load() {
    this.manifest ??= fetch(new URL('list', BASE)).then(r => r.ok ? r.json() : {}).catch(() => ({}));
    return this.manifest;
  }

  buffer(ctx, { file, v }) {
    if (!this.buffers.has(file)) {
      this.buffers.set(file, fetch(new URL(`${file}?v=${encodeURIComponent(v)}`, BASE))
        .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(b => ctx.decodeAudioData(b))
        .catch(e => { this.buffers.delete(file); throw e; }));
    }
    return this.buffers.get(file);
  }

  /**
   * A transmission from the server ({t: 'radio', ...}) - if this player wants
   * it. Without its sound (no speech service, or the sound off here) a long
   * line still comes, as text on the comms. A line about a battle (where)
   * waits until that battle has played out on the map.
   */
  receive(m) {
    // About a battle: once it has played out on the map ("Open fire!" at its start).
    const at = m.where ? this.moment(m.where, m.where.when) : null;
    const wait = at == null ? 0 : Math.min(MAX_WAIT_MS, at - performance.now() + (m.where.when === 'start' ? 0 : AFTER_BATTLE_MS));
    if (wait > 50) { setTimeout(() => this.deliver(m), wait); return true; }
    return this.deliver(m);
  }

  deliver(m) {
    if (this.level === 'off' || (this.level === 'important' && !m.important)) return false;
    const item = { speaker: m.speaker, clip: { file: m.file ?? null, v: m.v ?? null, text: m.text }, from: m.from, name: m.name, short: !!m.short,
      planetId: m.where?.planetId ?? null };
    if (!m.file || !sfx.on) {
      if (!item.short) this.emit({ ...item, textOnly: !m.file });
      return false;
    }
    this.push(item);
    return true;
  }

  /** Plays a line heard before once more - asked for, so it does not wait for the CB radio. */
  replay(item) {
    if (!item?.clip?.file) return false;
    this.push({ ...item, replay: true });
    return true;
  }

  emit(item) {
    for (const fn of this.listeners) { try { fn(item); } catch (e) { console.warn(e); } }
  }

  /**
   * A clip by speaker and event - for the debug dialog.
   * @param {number} [n] variant (0-based) - random without
   */
  async say(speaker, event, n) {
    if (!sfx.on) return false;
    const m = await this.load();
    const clips = m[speaker]?.[event];
    if (!clips?.length) return false;
    const clip = clips[n ?? Math.floor(Math.random() * clips.length)] ?? clips[0];
    this.push({ speaker, clip, from: null, name: null, debug: true });
    return true;
  }

  /**
   * Right now or not at all - for the crew's answers to a click: if anything
   * is on the radio or waiting, the answer is dropped, it would be stale.
   */
  instant(item) {
    if (this.busy || this.queue.length || this.blocked() || !sfx.on) return false;
    this.push(item);
    return true;
  }

  push(item) {
    item.at = Date.now();
    this.queue.push(item);
    this.next();
  }

  async next() {
    if (this.busy) return;
    // Old news is dropped; while a person talks, the chatter waits.
    while (this.queue.length && Date.now() - this.queue[0].at > STALE_MS) this.queue.shift();
    if (!this.queue.length) return;
    if (this.blocked() && !this.queue[0].debug && !this.queue[0].replay) { setTimeout(() => this.next(), 400); return; }
    this.busy = true;
    const item = this.queue.shift();
    try {
      const ctx = sfx.start();
      if (ctx && sfx.on) {
        const buf = await this.buffer(ctx, item.clip);
        this.emit(item);
        const p = PROFILES[item.speaker] || PROFILES[item.speaker.replace(/\d+$/, '')] || PROFILES.default;
        await this.transmit(ctx, buf, { ...p, pitch: p.pitch * tint(item.from) });
      }
    } catch (e) {
      console.warn('radio:', item.clip.file, e);
    }
    this.busy = false;
    this.next();
  }

  /** Cuts off the current transmission and empties the line. */
  stop() {
    this.queue.length = 0;
    this.current?.();
  }

  /** One transmission: squelch, voice through the radio, roger beep. Resolves when done. */
  transmit(ctx, buf, p) {
    sfx.keepAwake();
    const t0 = ctx.currentTime + 0.05;
    const nodes = [];
    const track = n => (nodes.push(n), n);

    // Everything of this transmission goes through one gain - to cut it off.
    const out = track(ctx.createGain());
    out.gain.value = LEVEL;
    out.connect(sfx.master);

    // The radio: band, presence, crunch.
    const hp = track(ctx.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = p.band[0];
    const lp = track(ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = p.band[1];
    const peak = track(ctx.createBiquadFilter()); peak.type = 'peaking';
    peak.frequency.value = Math.sqrt(p.band[0] * p.band[1]); peak.gain.value = 6;
    const crunch = track(ctx.createWaveShaper()); crunch.curve = softClip(p.crunch); crunch.oversample = '2x';
    const radio = track(ctx.createGain()); radio.gain.value = 0.9;
    hp.connect(peak); peak.connect(lp); lp.connect(crunch); crunch.connect(radio); radio.connect(out);

    // The voice - with the aliens through ring modulator and staircase first.
    const voiceIn = track(ctx.createGain());
    let into = hp;
    if (p.crush) {
      const crush = track(ctx.createWaveShaper()); crush.curve = staircase(p.crush);
      crush.connect(into); into = crush;
    }
    if (p.ring) {
      // Ring modulation: the voice's gain swings between -1 and 1 at the
      // carrier frequency. Half of it stays dry so the words carry.
      const ring = track(ctx.createGain()); ring.gain.value = 0;
      const osc = track(ctx.createOscillator()); osc.frequency.value = p.ring;
      osc.connect(ring.gain); osc.start(t0); osc.stop(t0 + buf.duration / p.pitch + 1);
      const dry = track(ctx.createGain()); dry.gain.value = 0.5;
      voiceIn.connect(ring); voiceIn.connect(dry);
      ring.connect(into); dry.connect(into);
    } else {
      voiceIn.connect(into);
    }

    const len = buf.duration / p.pitch;
    const voices = [[p.pitch, 0, 1], ...(p.swarm || []).map(([r, d, g]) => [p.pitch * r, d, g])];
    let end = t0 + 0.12;
    for (const [rate, delay, gain] of voices) {
      const src = track(ctx.createBufferSource());
      src.buffer = buf; src.playbackRate.value = rate;
      if (p.warble) {
        const lfo = track(ctx.createOscillator()), depth = track(ctx.createGain());
        lfo.frequency.value = 4 + Math.random() * 3; depth.gain.value = p.warble;
        lfo.connect(depth); depth.connect(src.detune); lfo.start(t0); lfo.stop(t0 + len * 1.3 + 1);
      }
      const g = track(ctx.createGain()); g.gain.value = gain;
      src.connect(g); g.connect(voiceIn);
      const at = t0 + 0.12 + delay;
      src.start(at);
      end = Math.max(end, at + buf.duration / rate);
    }

    // Dropouts: the signal dips for a moment and crackles.
    const fade = radio.gain;
    const drops = Math.round(p.crackle * len * 1.2 * Math.random() + p.crackle * 1.5);
    for (let i = 0; i < drops; i++) {
      const at = t0 + 0.3 + Math.random() * Math.max(0.1, len - 0.5), d = 0.03 + Math.random() * 0.1;
      fade.setValueAtTime(0.9, at);
      fade.linearRampToValueAtTime(0.12, at + 0.01);
      fade.setValueAtTime(0.12, at + d);
      fade.linearRampToValueAtTime(0.9, at + d + 0.015);
      this.burst(ctx, out, at, d + 0.02, 0.2 * p.crackle + 0.05, p.band);
    }

    // Squelch on, carrier hiss under the voice, squelch off.
    this.burst(ctx, out, t0, 0.1, p.squelch ?? 0.32, p.band);
    const hiss = this.noise(ctx, out, p.band, track);
    hiss.gain.setValueAtTime(0, t0);
    hiss.gain.linearRampToValueAtTime(p.hiss, t0 + 0.03);
    const rogerAt = end + 0.08;
    const rogerEnd = this.roger(ctx, out, rogerAt, p.roger);
    hiss.gain.setValueAtTime(p.hiss, rogerEnd);
    hiss.gain.linearRampToValueAtTime(0, rogerEnd + 0.05);
    this.burst(ctx, out, rogerEnd, 0.16, (p.squelch ?? 0.32) * 0.9, p.band);
    const done = rogerEnd + 0.25;

    return new Promise(resolve => {
      const finish = () => {
        clearTimeout(timer);
        this.current = null;
        try { out.disconnect(); } catch {}
        for (const n of nodes) { try { n.stop?.(); } catch {} }
        sfx.keepAwake();
        resolve();
      };
      const timer = setTimeout(finish, (done - ctx.currentTime) * 1000);
      this.current = finish;
    });
  }

  /** A short burst of band-limited noise: squelch, crackle. */
  burst(ctx, out, at, dur, gain, band) {
    const s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    s.buffer = noiseBuffer(ctx);
    f.type = 'bandpass'; f.frequency.value = Math.sqrt(band[0] * band[1]); f.Q.value = 0.7;
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(at, Math.random() * 0.5); s.stop(at + dur + 0.01);
  }

  /** Steady carrier noise; its gain is the returned node. */
  noise(ctx, out, band, track) {
    const s = track(ctx.createBufferSource()), f = track(ctx.createBiquadFilter()), g = track(ctx.createGain());
    s.buffer = noiseBuffer(ctx); s.loop = true;
    f.type = 'bandpass'; f.frequency.value = Math.sqrt(band[0] * band[1]); f.Q.value = 0.5;
    g.gain.value = 0;
    s.connect(f); f.connect(g); g.connect(out);
    s.start();
    return g;
  }

  /** The end tones; returns when they are over. */
  roger(ctx, out, at, tones) {
    if (tones === 'chirp') {
      // The aliens: a falling, wobbling whistle instead of a beep.
      const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), d = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(2400, at); o.frequency.exponentialRampToValueAtTime(300, at + 0.45);
      lfo.frequency.value = 23; d.gain.value = 120; lfo.connect(d); d.connect(o.frequency);
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.07, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.45);
      o.connect(g); g.connect(out);
      o.start(at); lfo.start(at); o.stop(at + 0.5); lfo.stop(at + 0.5);
      return at + 0.45;
    }
    let t = at;
    for (const [f, dur] of tones) {
      if (f) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'square'; o.frequency.value = f;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.005);
        g.gain.setValueAtTime(0.06, t + dur - 0.01); g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(g); g.connect(out);
        o.start(t); o.stop(t + dur + 0.02);
      }
      t += dur;
    }
    return t;
  }
}

function softClip(k) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
  return curve;
}

/** Fewer steps, coarser: the digital grit of the alien signal. */
function staircase(bits) {
  const n = 2048, steps = 2 ** bits, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.round(x * steps / 2) / (steps / 2); }
  return curve;
}

let noise = null;
function noiseBuffer(ctx) {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

function loadLevel() {
  try { const v = localStorage.getItem(PREF_KEY); if (RADIO_LEVELS.includes(v)) return v; } catch {}
  return 'all';
}

export const radio = new Radio();
