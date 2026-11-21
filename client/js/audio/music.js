// Background music. Like the effects (sfx.js) it is synthesized in the
// browser, no audio files: a generative ambient piece that never repeats.
//
// It moves through sections, a minute or three each. A section draws three
// things at random and combines them:
//   - a mood: key, mode, chords (MOODS), transposed a few semitones,
//   - an energy: which voices take part - from a sparse void of drone, stars
//     and sonar over calm pads and a flowing arpeggio to a soft pulse (ENERGY),
//   - the instruments: pad, arpeggio and melody sound (PADS, ARPS, LEADS),
//     plus tempo, chord length, reverb and echo.
// Under everything a drone that glides to each new root; now and then a
// short gliding phrase, a distant ping of a star, a breath of solar wind.
// Meant to stay out of the way: quiet, no drums, nothing that starts suddenly.
//
// Own audio context: the effects suspend theirs after a silence, the music
// must keep running. It pauses while the tab is hidden. next() cuts to a new
// piece: fade out, a moment of silence, a fresh start.

const KEY = 'ho-music';
const LEVEL = 0.5;            // output at the full slider (squared curve below)
const FADE_IN = 8;            // seconds: the music never starts abruptly
const AHEAD = 4;              // seconds scheduled in advance
const DRONE = 0.004;          // level of the drone, where it plays: under the pads

const hz = n => 440 * 2 ** ((n - 69) / 12);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
/** Picks a key of `weights` ({key: weight}) in proportion to its weight. */
const weighted = (weights) => {
  let r = Math.random() * Object.values(weights).reduce((a, b) => a + b, 0);
  for (const [k, w] of Object.entries(weights)) if ((r -= w) < 0) return k;
  return Object.keys(weights)[0];
};

const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const WHOLE = [0, 2, 4, 6, 8, 10];
const PHRYGIAN_DOM = [0, 1, 4, 5, 7, 8, 10];

// The moods. root: MIDI note of the drone; chords: semitones above the octave
// over the root; step: seconds per arpeggio step; melody: how likely a phrase
// is; bright: where the pad filter sits; still: never with arpeggio or pulse.
const MOODS = [
  { name: 'drift', root: 38, scale: AEOLIAN, step: 0.4, melody: 0.3, bright: 800,
    chords: [[0, 7, 10, 14, 15], [-4, 3, 7, 12, 14], [-7, 0, 3, 7, 10], [-2, 5, 12, 14, 17]] },
  { name: 'glow', root: 41, scale: LYDIAN, step: 0.38, melody: 0.7, bright: 1150,
    chords: [[0, 7, 11, 16, 18], [0, 2, 6, 9, 14], [4, 11, 14, 18, 19], [-5, 2, 6, 9, 11]] },
  { name: 'pulse', root: 45, scale: AEOLIAN, step: 0.3, melody: 0.35, bright: 950,
    chords: [[0, 7, 12, 14, 15], [-4, 3, 7, 12, 15], [-9, -2, 5, 7, 10], [-2, 5, 7, 10, 14]] },
  { name: 'deep', root: 36, scale: PHRYGIAN, step: 0.45, melody: 0.4, bright: 600,
    chords: [[0, 7, 12, 14, 15], [1, 8, 12, 17], [-2, 5, 8, 13], [-4, 3, 7, 12]] },
  { name: 'horizon', root: 40, scale: MIXOLYDIAN, step: 0.34, melody: 0.6, bright: 1000,
    chords: [[0, 7, 14, 16, 19], [-2, 5, 10, 14], [5, 9, 12, 17], [-5, 2, 5, 10, 14]] },
  { name: 'tide', root: 43, scale: DORIAN, step: 0.42, melody: 0.5, bright: 850,
    chords: [[0, 7, 10, 14, 17], [5, 9, 12, 16], [-2, 5, 9, 14], [3, 10, 14, 17]] },
  { name: 'nebula', root: 40, scale: WHOLE, step: 0.4, melody: 0.45, bright: 900,
    chords: [[0, 4, 8, 14, 18], [2, 6, 10, 16], [-2, 4, 8, 12], [-4, 2, 6, 10, 14]] },
  { name: 'hope', root: 38, scale: IONIAN, step: 0.32, melody: 0.65, bright: 1100,
    chords: [[0, 7, 11, 14, 16], [5, 9, 12, 17], [-3, 4, 7, 12], [2, 5, 9, 12, 16]] },
  { name: 'ancient', root: 40, scale: PHRYGIAN_DOM, step: 0.33, melody: 0.8, bright: 850,
    chords: [[0, 7, 12, 16], [1, 5, 8, 12, 17], [-2, 5, 10, 13], [5, 8, 12, 17]] },
  { name: 'void', root: 37, scale: AEOLIAN, step: 0.5, melody: 0.3, bright: 500, still: true,
    chords: [[0, 7, 14], [0, 5, 10], [-2, 5, 12], [-4, 3, 10]] }
];

// Energies. pad: level of the pads; notes: at most that many per chord;
// arp: how often a chord carries the arpeggio; bass: a soft pulse on the
// root; sonar: how likely sonar pings; bells: how often stars; len: chord
// length in seconds.
const ENERGY = {
  sparse: { pad: 0.45, notes: 3, arp: 0, bass: false, sonar: 0.9, bells: 1.5, len: [20, 30] },
  calm: { pad: 1, notes: 6, arp: 0, bass: false, sonar: 0.3, bells: 1, len: [15, 24] },
  flow: { pad: 0.85, notes: 6, arp: 0.75, bass: false, sonar: 0, bells: 0.8, len: [12, 20] },
  drive: { pad: 0.7, notes: 5, arp: 0.9, bass: true, sonar: 0, bells: 0.6, len: [9, 15] }
};

// Pad sounds: partials [type, detune cents, level, frequency multiple];
// formants turn two saws into a distant choir.
const PADS = {
  warm: { gain: 1, parts: [['sine', 0, 1, 1], ['triangle', 6, 0.5, 1], ['triangle', -6, 0.5, 1]] },
  strings: { gain: 0.4, parts: [['sawtooth', 8, 0.5, 1], ['sawtooth', -8, 0.5, 1], ['sawtooth', 1, 0.3, 2]] },
  glass: { gain: 0.9, parts: [['sine', 0, 1, 1], ['sine', 4, 0.35, 2], ['sine', -4, 0.15, 3]] },
  hollow: { gain: 0.42, parts: [['square', 0, 0.5, 1], ['sine', 0, 0.7, 1], ['square', 7, 0.2, 2]] },
  choir: { gain: 2.4, parts: [['sawtooth', 6, 0.5, 1], ['sawtooth', -6, 0.5, 1]], formants: [[650, 5], [1080, 6]] }
};
const ARPS = ['pluck', 'marimba', 'pulse', 'glass'];
const LEADS = ['flute', 'reed', 'glide'];

// Arpeggio patterns as index sequences into the chord (wrapped).
const PATTERNS = [[0, 1, 2, 3], [0, 1, 2, 3, 2, 1], [0, 2, 1, 3], [0, 2, 4, 2, 1, 3], [3, 2, 1, 0, 1, 2], [0, 3, 1, 2]];
// Bass pulse: level per half beat (an arpeggio step x 2).
const PULSES = [[1, 0, 0, 0], [1, 0, 0.55, 0], [1, 0, 0, 0.5, 0, 0, 0.6, 0], [1, 0, 0, 0, 0.6, 0, 0, 0]];

export class Music {
  constructor() {
    const s = load();
    this.on = s.on;
    this.volume = s.volume;
    this.ctx = null;
    this.out = null;
    this._timer = null;
    this._hush = null;
    this._history = [];         // last moods, not repeated soon
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this._pause(); else this.start();
      });
    }
  }

  /** Audio may only start after a user action - the first click wakes it. */
  start() {
    if (!this.on || (typeof document !== 'undefined' && document.hidden)) return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC({ latencyHint: 'playback' }); } catch { return; }
      this.build(this.ctx, this.ctx.destination);
    }
    clearTimeout(this._hush);
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this._fade(this.level(), FADE_IN / 3);
    if (!this._timer) {
      this.schedule(this.ctx.currentTime + AHEAD);
      this._timer = setInterval(() => this.schedule(this.ctx.currentTime + AHEAD), 1000);
    }
  }

  setEnabled(on) {
    this.on = !!on;
    save(this);
    if (this.on) this.start(); else this._pause();
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    save(this);
    if (this.on && this.ctx) this._fade(this.level(), 0.15);
  }

  /**
   * The next piece: the one playing fades out as a whole - drone, reverb and
   * echo with it - a moment of silence, then a new one fades in, in another
   * mood and key, on a graph of its own.
   */
  next() {
    if (!this.on) return;
    if (!this.ctx) { this.start(); return; }
    const ctx = this.ctx, now = ctx.currentTime;
    if (this._switchUntil > now) return;              // already changing
    const old = this.out;
    old.gain.cancelScheduledValues(now);
    old.gain.setValueAtTime(old.gain.value, now);
    old.gain.setTargetAtTime(0, now, 0.22);
    for (const o of [...this._oscs, ...[...this._live.values()].flat()]) {
      try { o.stop(now + 2.2); } catch {}
    }
    const oldHp = this.highpass;
    setTimeout(() => { old.disconnect(); oldHp.disconnect(); }, 3000);
    const from = this._switchUntil = now + 2.4;
    this.build(ctx, ctx.destination, from);
    this.out.gain.setValueAtTime(0, from);
    this.out.gain.setTargetAtTime(this.level(), from, 1.2);
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (!this._timer) this._timer = setInterval(() => this.schedule(this.ctx.currentTime + AHEAD), 1000);
    this.schedule(now + AHEAD);
  }

  /** Slider -> gain: squared, so the lower half stays really quiet. */
  level() { return this.volume * this.volume * LEVEL; }

  _fade(to, tau) {
    if (!this.out) return;
    const g = this.out.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(to, now, tau);
  }

  /** Fade out, stop scheduling, then suspend the context (costs no CPU). */
  _pause() {
    clearInterval(this._timer);
    this._timer = null;
    if (!this.ctx || this.ctx.state !== 'running') return;
    this._fade(0, 0.25);
    clearTimeout(this._hush);
    this._hush = setTimeout(() => {
      if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
    }, 1200);
  }

  // ------------------------------------------------------------ The graph

  /**
   * Builds the fixed part - output, reverb, echo, the drone - and draws the
   * section the piece begins with at `from`.
   */
  build(ctx, dest, from = ctx.currentTime) {
    this.ctx = ctx;
    this._oscs = [];            // drone and LFOs, taken down by next()
    const out = this.out = ctx.createGain();
    out.gain.value = 0;
    // No rumble: nothing under 110 Hz, reverb tails included.
    const hp = this.highpass = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 110;
    hp.Q.value = 0.6;
    out.connect(hp).connect(dest);

    // Long, dark reverb - most of what is heard comes out of it.
    const verb = this.verb = ctx.createConvolver();
    verb.buffer = this._impulse ||= impulse(ctx, 6);
    const wet = this.wet = ctx.createGain();
    wet.gain.value = 0.9;
    verb.connect(wet).connect(out);
    const dry = this.dry = ctx.createGain();
    dry.gain.value = 0.3;
    dry.connect(out);

    // Pads through a lowpass that opens and closes very slowly.
    const pad = this.pad = ctx.createBiquadFilter();
    pad.type = 'lowpass';
    pad.frequency.value = 800;
    pad.Q.value = 0.4;
    this.padLevel = ctx.createGain();
    this.padLevel.connect(pad);
    pad.connect(dry);
    pad.connect(verb);
    this._lfo(0.017, 320, pad.frequency);

    // Echo for stars, sonar and arpeggio: it loses its highs on the way.
    const echo = this.echo = ctx.createGain();
    const delay = this.delay = ctx.createDelay(2);
    delay.delayTime.value = 0.87;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2200;
    const fb = this.feedback = ctx.createGain();
    fb.gain.value = 0.42;
    echo.connect(delay).connect(damp).connect(fb).connect(delay);
    echo.connect(verb);
    damp.connect(verb);
    const echoDry = ctx.createGain();
    echoDry.gain.value = 0.25;
    echo.connect(echoDry).connect(dry);

    // The arpeggio swells in and out as a whole; the bass pulse too.
    this.arpBus = ctx.createGain();
    this.arpBus.gain.value = 0;
    this.arpBus.connect(echo);
    this.bassBus = ctx.createGain();
    this.bassBus.gain.value = 0;
    const blp = ctx.createBiquadFilter();
    blp.type = 'lowpass';
    blp.frequency.value = 450;
    this.bassBus.connect(blp);
    blp.connect(dry);
    const bverb = ctx.createGain();
    bverb.gain.value = 0.3;
    blp.connect(bverb).connect(verb);

    // The drone: a soft hum an octave over the root, against itself a hair
    // apart (a beat so slow it is hardly heard), a fifth above, under a
    // lowpass, breathing slowly. Not always there: it carries the sparse
    // sections, comes now and then in the calm ones and keeps silent while
    // the arpeggio moves (_enter) - so no tone sits under everything.
    const drone = ctx.createGain();           // breathes (LFO around 1)
    const droneLevel = this.droneLevel = ctx.createGain();
    droneLevel.gain.value = 0;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 420;
    drone.connect(droneLevel).connect(dlp);
    dlp.connect(dry);
    dlp.connect(verb);
    this.drone = [];
    for (const [semi, ratio, type, g] of [[12, 1, 'sine', 1], [12, 1.0012, 'sine', 0.6],
      [19, 1, 'sine', 0.3]]) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = type;
      o.frequency.value = hz(MOODS[0].root + semi) * ratio;
      og.gain.value = g;
      o.connect(og).connect(drone);
      o.start();
      this._oscs.push(o);
      this.drone.push({ o, semi, ratio });
    }
    this._lfo(0.043, 0.3, drone.gain);

    // Solar wind: one loop of noise, shared by every gust.
    if (!this.noise) {
      const n = ctx.sampleRate * 4;
      this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }

    this.mood = null;
    this.root = null;
    this._next = null;
    this._from = from;
    this._live = new Map();     // pad and melody voices -> oscillators, for next()
    this._enter(from, true);
  }

  _lfo(rate, depth, param) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = rate;
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start(this.ctx.currentTime + rnd(0, 5));
    this._oscs.push(o);
  }

  /**
   * Schedules everything that starts before `until` (context time), in the
   * order of time - so every voice hears the section and chord valid then.
   */
  schedule(until) {
    const now = Math.max(this.ctx.currentTime, this._from || 0);
    let s = this._next;
    if (!s || s.chord < now - 1) {
      s = this._next = { chord: now + 0.3, arp: now + 0.3, bass: now + 0.3, star: now + rnd(6, 12),
        wind: now + rnd(25, 50), melody: now + rnd(20, 35), sonar: now + rnd(4, 9) };
    }
    const voices = {
      chord: t => this.chord(t),
      arp: t => this.arpStep(t),
      bass: t => this.bassStep(t),
      star: t => this.ping(t),
      wind: t => this.wind(t),
      melody: t => this.melody(t),
      sonar: t => this.sonar(t)
    };
    for (;;) {
      let first = null;
      for (const k in voices) if (first === null || s[k] < s[first]) first = k;
      if (s[first] >= until) break;
      s[first] += voices[first](s[first]);
    }
  }

  /**
   * A new section: mood, key, energy, instruments, tempo, room. The drone
   * glides to its root - or, at the start of a piece, simply begins there.
   */
  _enter(t, fresh = false) {
    let m;
    do { m = pick(MOODS); } while (this._history.includes(m.name));
    this._history = [m.name, ...this._history].slice(0, 2);
    this.mood = m;
    const shifts = [-5, -3, -2, 0, 0, 2, 3, 5].filter(d => m.root + d >= 34 && m.root + d <= 46);
    this.root = m.root + pick(shifts);
    const energy = m.still ? weighted({ sparse: 2, calm: 1 })
      : weighted({ sparse: 1, calm: 2, flow: 3.5, drive: 2.5 });
    const e = ENERGY[energy];
    const step = m.step * pick([0.8, 1, 1, 1.25]) * (energy === 'drive' ? 0.9 : 1);
    this.sec = {
      energy, e, step,
      pad: pick(Object.keys(PADS)),
      arp: pick(ARPS),
      lead: pick(LEADS),
      pulse: pick(PULSES),
      sonar: Math.random() < e.sonar,
      len: e.len
    };
    this._left = 4 + Math.floor(Math.random() * 4);   // chords in this section
    this._chordIdx = -1;

    const set = (param, v, tau) => fresh ? (param.value = v) : param.setTargetAtTime(v, t, tau);
    for (const { o, semi, ratio } of this.drone) set(o.frequency, hz(this.root + semi) * ratio, 2.5);
    set(this.pad.frequency, m.bright * (this.sec.pad === 'strings' || this.sec.pad === 'hollow' ? 0.8 : 1), 6);
    set(this.padLevel.gain, e.pad, 5);
    const hum = energy === 'sparse' || (energy === 'calm' && Math.random() < 0.5);
    set(this.droneLevel.gain, hum ? DRONE : 0, fresh ? 0 : 6);
    set(this.delay.delayTime, Math.min(1.9, step * pick([2, 3, 3])), 3);
    set(this.feedback.gain, rnd(0.3, 0.52), 4);
    set(this.wet.gain, rnd(0.75, 1.05), 5);
    set(this.bassBus.gain, e.bass ? 1 : 0, 4);
    if (!fresh) this.wind(t - 3);                     // a breath across the seam
  }

  // ------------------------------------------------------------ The voices

  /** A chord that swells in over seconds and fades out into the next one. */
  chord(t) {
    if (!this.mood || --this._left < 0) this._enter(t);
    const m = this.mood, sec = this.sec;
    const len = rnd(...sec.len);
    let i;
    do { i = Math.floor(Math.random() * m.chords.length); } while (i === this._chordIdx);
    this._chordIdx = i;
    const base = this.root + 12;
    const chord = m.chords[i].map(o => base + o);
    this._cur = chord;

    // The arpeggio: in many chords it swells in, then out again.
    this._arpOn = Math.random() < sec.e.arp;
    const g = this.arpBus.gain;
    g.setTargetAtTime(this._arpOn ? 1 : 0, t, this._arpOn ? 2.5 : 2);
    if (this._arpOn) g.setTargetAtTime(0, t + len - 3, 2);
    this._pattern = pick(PATTERNS);
    this._arpNotes = chord.slice(1).map(n => n + 12);
    this._arpI = 0;

    let notes = chord.filter((_, k) => k === 0 || Math.random() > 0.15);
    if (Math.random() < 0.3) notes.push(chord[2] + 12);
    notes = notes.slice(0, sec.e.notes);
    const attack = Math.min(6, len * 0.4), release = Math.min(10, len * 0.6);
    for (const n of notes) this._padNote(n, t + rnd(0, 2), attack, t + len, t + len + release);
    return len;
  }

  _padNote(n, at, attack, hold, end) {
    const ctx = this.ctx, sound = PADS[this.sec.pad];
    const g = ctx.createGain();
    const peak = 0.018 * sound.gain * (n < 50 ? 0.75 : n > 64 ? 0.7 : 1);
    const oscs = [];
    g.gain.value = 0;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.setValueAtTime(peak, hold);
    g.gain.linearRampToValueAtTime(0, end);
    this._live.set(g, oscs);
    let into = g;
    if (sound.formants) {
      // Two vowel resonances in parallel: from a saw to an "aah".
      into = ctx.createGain();
      for (const [f, q] of sound.formants) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f * rnd(0.95, 1.05);
        bp.Q.value = q;
        into.connect(bp).connect(g);
      }
    }
    this._pan(g, rnd(-0.5, 0.5)).connect(this.padLevel);
    for (const [type, cents, lvl, mult] of sound.parts) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = type;
      o.frequency.value = hz(n) * mult;
      o.detune.value = cents ? cents + rnd(-2, 2) : 0;
      og.gain.value = lvl;
      o.connect(og).connect(into);
      o.start(at);
      o.stop(end + 0.1);
      oscs.push(o);
      o.onended = () => { g.disconnect(); this._live.delete(g); };
    }
  }

  /** One step of the arpeggio from the current chord, in this section's sound. */
  arpStep(t) {
    const step = this.sec?.step || 0.5;
    if (!this._arpOn || !this._arpNotes) return step;
    const notes = this._arpNotes, pat = this._pattern;
    const i = this._arpI++;
    if (Math.random() < 0.1) return step;              // a breath now and then
    const n = notes[pat[i % pat.length] % notes.length];
    const accent = i % pat.length === 0 ? 1 : 0.7;
    const ctx = this.ctx, g = ctx.createGain();
    const voice = (type, f, lvl) => {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = type;
      o.frequency.value = f;
      og.gain.value = lvl;
      o.connect(og);
      return [o, og];
    };
    let parts, peak, decay, lp = null;
    switch (this.sec.arp) {
      case 'marimba':       // wooden: a quick sine with a ring four times up
        parts = [voice('sine', hz(n), 1), voice('sine', hz(n) * 4, 0.12)];
        peak = 0.035; decay = 0.7;
        break;
      case 'pulse':         // a soft square, quickly closed
        parts = [voice('square', hz(n), 1)];
        lp = [1800, 380, 0.25];
        peak = 0.018; decay = 0.45;
        break;
      case 'glass':         // high and long
        parts = [voice('sine', hz(n + 12), 1), voice('sine', hz(n + 12) * 2.01, 0.2)];
        peak = 0.018; decay = 2.2;
        break;
      default:              // pluck
        parts = [voice('triangle', hz(n), 1)];
        lp = [2600, 500, 0.5];
        peak = 0.03; decay = 1.1;
    }
    let into = g;
    if (lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(lp[0], t);
      f.frequency.exponentialRampToValueAtTime(lp[1], t + lp[2]);
      f.connect(g);
      into = f;
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak * accent, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    this._pan(g, i % 2 ? 0.3 : -0.3).connect(this.arpBus);
    for (const [o, og] of parts) {
      og.connect(into);
      o.start(t);
      o.stop(t + decay + 0.1);
    }
    parts[0][0].onended = () => g.disconnect();
    return step;
  }

  /** The soft pulse of the driving sections: the chord's root, low and round. */
  bassStep(t) {
    const step = (this.sec?.step || 0.5) * 2;
    if (!this.sec?.e.bass || !this._cur) return step;
    const i = this._bassI = ((this._bassI || 0) + 1);
    const lvl = this.sec.pulse[i % this.sec.pulse.length];
    if (!lvl) return step;
    let n = this._cur[0];
    while (n > 57) n -= 12;
    while (n < 46) n += 12;
    const ctx = this.ctx, g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.055 * lvl, t + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.6);
    g.connect(this.bassBus);
    for (const [type, mult, l] of [['sine', 1, 1], ['triangle', 2, 0.25]]) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = type;
      o.frequency.value = hz(n) * mult;
      og.gain.value = l;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + step * 1.6 + 0.1);
      if (mult === 1) o.onended = () => g.disconnect();
    }
    return step;
  }

  /** A short phrase far off: a few long notes gliding into each other. */
  melody(t) {
    const m = this.mood;
    const wait = rnd(16, 36);
    if (!m || Math.random() > m.melody) return wait;
    const scale = [];
    for (let n = 60; n <= 81; n++) if (m.scale.includes(((n - this.root) % 12 + 12) % 12)) scale.push(n);
    let k = Math.floor(rnd(scale.length * 0.3, scale.length * 0.7));
    const count = 3 + Math.floor(Math.random() * 4);
    const line = [];
    for (let j = 0; j < count; j++) {
      line.push(scale[k]);
      k = Math.max(0, Math.min(scale.length - 1, k + pick([-2, -1, -1, 1, 1, 2, 0])));
    }
    // End on a tone of the chord that sounds then.
    const tones = (this._cur || []).map(n => ((n % 12) + 12) % 12);
    const last = line[line.length - 1];
    const close = scale.filter(n => tones.includes(n % 12)).sort((a, b) => Math.abs(a - last) - Math.abs(b - last))[0];
    if (close) line[line.length - 1] = close;

    const ctx = this.ctx, lead = this.sec.lead;
    const [type, overtone, cutoff, glide, peak] = {
      flute: ['sine', 0.12, 1800, 0.07, 0.02],
      reed: ['square', 0, 1100, 0.06, 0.012],
      glide: ['sawtooth', 0, 900, 0.18, 0.014]
    }[lead];
    const o = ctx.createOscillator(), o2 = ctx.createGain(), h = ctx.createOscillator();
    const lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = type;
    h.type = 'sine';
    o2.gain.value = overtone;
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    o.connect(lp);
    h.connect(o2).connect(lp);
    lp.connect(g);
    this._live.set(g, [o, h]);
    const p = this._pan(g, rnd(-0.35, 0.35));
    p.connect(this.verb);
    p.connect(this.dry);
    // Vibrato that only sets in on the long notes.
    const vib = ctx.createOscillator(), vd = ctx.createGain();
    vib.frequency.value = rnd(4.2, 5.2);
    vd.gain.value = 0;
    vib.connect(vd);
    vd.connect(o.detune);
    vd.connect(h.detune);
    this._live.get(g).push(vib);
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    let at = t;
    line.forEach((n, j) => {
      const dur = rnd(1.3, 2.8) * (j === line.length - 1 ? 1.6 : 1);
      if (j === 0) {
        o.frequency.setValueAtTime(hz(n), at);
        h.frequency.setValueAtTime(hz(n) * 2, at);
      } else {
        o.frequency.setTargetAtTime(hz(n), at, glide);
        h.frequency.setTargetAtTime(hz(n) * 2, at, glide);
      }
      g.gain.setTargetAtTime(peak, at, j === 0 ? 0.6 : 0.15);
      g.gain.setTargetAtTime(peak * 0.65, at + dur - 0.3, 0.12);
      vd.gain.setTargetAtTime(0, at, 0.05);
      vd.gain.setTargetAtTime(9, at + 0.6, 0.5);
      at += dur;
    });
    g.gain.setTargetAtTime(0, at, 0.9);
    for (const x of [o, h, vib]) { x.start(t); x.stop(at + 6); }
    o.onended = () => { g.disconnect(); this._live.delete(g); };
    return wait + (at - t);
  }

  /** A star far away: a soft bell, sometimes two or three, with an echo. */
  ping(t) {
    const m = this.mood || MOODS[0], root = this.root ?? m.root;
    const high = [];
    for (let n = 74; n <= 91; n++) if (m.scale.includes(((n - root) % 12 + 12) % 12)) high.push(n);
    const count = Math.random() < 0.25 ? (Math.random() < 0.5 ? 2 : 3) : 1;
    let at = t;
    for (let k = 0; k < count; k++) {
      const f = hz(pick(high));
      const g = this.ctx.createGain();
      const peak = rnd(0.012, 0.022);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 3.5);
      this._pan(g, rnd(-0.8, 0.8)).connect(this.echo);
      // A partial at 2.76x makes it a bell rather than a beep.
      for (const [mult, lvl] of [[1, 1], [2.76, 0.18]]) {
        const o = this.ctx.createOscillator(), og = this.ctx.createGain();
        o.frequency.value = f * mult;
        og.gain.value = lvl;
        o.connect(og).connect(g);
        o.start(at);
        o.stop(at + 3.6);
        o.onended = () => g.disconnect();
      }
      at += rnd(0.45, 0.9);
    }
    return rnd(6, 16) / (this.sec?.e.bells || 1);
  }

  /** Sonar in the quiet sections: a round ping that sinks a little, far off. */
  sonar(t) {
    const wait = rnd(7, 13);
    if (!this.sec?.sonar || !this._cur) return wait;
    const n = this._cur[0] + 24 + pick([0, 7, 12]);
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(hz(n), t);
    o.frequency.exponentialRampToValueAtTime(hz(n) * 0.985, t + 2);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.015, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    o.connect(g);
    this._pan(g, rnd(-0.6, 0.6)).connect(this.echo);
    o.start(t);
    o.stop(t + 2.5);
    o.onended = () => g.disconnect();
    return wait;
  }

  /** A gust of solar wind: filtered noise, rising and falling over seconds. */
  wind(t) {
    const ctx = this.ctx, dur = rnd(10, 16);
    t = Math.max(t, ctx.currentTime);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(rnd(250, 400), t);
    bp.frequency.exponentialRampToValueAtTime(rnd(900, 1500), t + dur * 0.5);
    bp.frequency.exponentialRampToValueAtTime(rnd(300, 500), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.03, t + dur * 0.5);
    g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(bp).connect(g);
    const p = this._pan(g, 0);
    if (p.pan) {
      const side = Math.random() < 0.5 ? -1 : 1;
      p.pan.setValueAtTime(-0.6 * side, t);
      p.pan.linearRampToValueAtTime(0.6 * side, t + dur);
    }
    p.connect(this.verb);
    p.connect(this.dry);
    src.start(t, rnd(0, 3.5));
    src.stop(t + dur + 0.1);
    src.onended = () => g.disconnect();
    return rnd(45, 90) / (this.sec?.energy === 'sparse' ? 1.8 : 1);
  }

  _pan(node, pan) {
    if (!this.ctx.createStereoPanner) return node;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(p);
    return p;
  }
}

/** Impulse response for the reverb: dark noise decaying over `secs`. */
function impulse(ctx, secs) {
  const rate = ctx.sampleRate, n = Math.round(rate * secs);
  const pre = Math.round(rate * 0.03);
  const buf = ctx.createBuffer(2, n, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      lp += 0.25 * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * (1 - (i - pre) / (n - pre)) ** 2.5;
    }
  }
  return buf;
}

// --------------------------------------------------------------- Settings
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s) return { on: s.on !== false, volume: typeof s.volume === 'number' ? s.volume : 0.5 };
  } catch {}
  return { on: true, volume: 0.5 };
}
function save(m) {
  try { localStorage.setItem(KEY, JSON.stringify({ on: m.on, volume: m.volume })); } catch {}
}

export const music = new Music();

/** The first click or key press starts the music (the browser wants one). */
export function bindMusic() {
  const wake = () => music.start();
  addEventListener('pointerdown', wake, { once: true, capture: true });
  addEventListener('keydown', wake, { once: true, capture: true });
}
