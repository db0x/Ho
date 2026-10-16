// Klangeffekte. Alles wird im Browser synthetisiert - keine Audiodateien,
// keine Abhängigkeiten, kein Build-Schritt.
//
// Aufbau: play(name) sucht ein Rezept, legt für diesen einen Klang einen Bus
// (Lautstärke + Stereoposition) an und setzt ihn aus Tönen und Rauschen
// zusammen. Die Drosselung verhindert, dass eine Runde mit fünf Raumschlachten
// zu Lärm wird: gleiche Effekte werden gestaffelt und begrenzt.

const KEY = 'ho-audio';
// Ausgangsanhebung: die Rezepte sind leise gemischt, damit sich zehn
// gleichzeitige Effekte nicht aufschaukeln. Der Begrenzer fängt die Spitzen.
const TRIM = 2.0;
// Ein laufender Audiokontext kostet auch in Stille Rechenzeit; nach dieser
// Stille halten wir ihn an, der nächste Klang weckt ihn wieder.
const IDLE_SUSPEND_MS = 20000;

export class Sfx {
  constructor() {
    const s = load();
    this.on = s.on;
    this.volume = s.volume;
    this.ctx = null;
    this.master = null;
    this._noise = null;
    this._recent = new Map();   // Rezeptname -> {last, n, since}
    this._pitch = 1;            // Zufallsstreuung des laufenden Klangs
    this._idle = null;          // Abschaltuhr
    this._everRan = false;
  }

  /** Audio darf erst nach einer Nutzeraktion starten - daher spät und faul. */
  start() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { this.ctx = new AC(); } catch { return null; }
      // Begrenzer, damit gleichzeitige Effekte nicht übersteuern
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.on ? this.volume * TRIM : 0;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.ctx.state === 'running') this._everRan = true;
    return this.ctx;
  }

  /** Nach längerer Stille den Kontext anhalten - sonst rechnet er weiter. */
  keepAwake() {
    clearTimeout(this._idle);
    this._idle = setTimeout(() => {
      if (this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
    }, IDLE_SUSPEND_MS);
  }

  setEnabled(on) {
    this.on = !!on;
    save(this);
    if (this.on) { this.start(); this.apply(); this.keepAwake(); return; }
    if (this.master) this.master.gain.value = 0;
    clearTimeout(this._idle);
    if (this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    save(this);
    this.apply();
  }

  apply() {
    if (this.master) this.master.gain.value = this.on ? this.volume * TRIM : 0;
  }

  /**
   * Spielt einen Effekt.
   * @param {string} name Rezeptname
   * @param {{pan?:number, gain?:number}} opts pan -1..1 (links/rechts), gain Faktor
   */
  play(name, opts = {}) {
    if (!this.on) return;
    const rec = RECIPES[name];
    if (!rec) return;
    const ctx = this.start();
    if (!ctx || ctx.state === 'closed') return;
    // Vor der ersten Nutzeraktion lässt der Browser keinen Ton zu - dann gar
    // nicht einplanen, sonst bricht beim Aufwachen alles auf einmal los.
    if (ctx.state !== 'running' && !this._everRan) return;

    // Beim Aufwachen etwas Vorlauf, damit der Anfang nicht verschluckt wird
    const lead = ctx.state === 'running' ? 0.005 : 0.09;
    const now = ctx.currentTime;
    const r = this._recent.get(name) || { last: 0, n: 0, since: 0 };
    if (now - r.since > 1) { r.n = 0; r.since = now; }
    if (r.n >= (rec.max ?? 4)) return;
    const at = Math.max(now + lead, r.last + (rec.gap ?? 0.07));
    if (at > now + 0.9) return;          // zu viel auf einmal: verwerfen
    r.last = at; r.n++;
    this._recent.set(name, r);

    // Leichte Tonhöhenstreuung, damit Wiederholungen nicht mechanisch klingen
    this._pitch = 1 + (Math.random() - 0.5) * (rec.vary ?? 0.05);
    rec.build(this, this.bus(opts), at);
    this.keepAwake();
  }

  /** Bus für einen einzelnen Klang: Lautstärke und Ort im Stereobild. */
  bus({ pan = 0, gain = 1 } = {}) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      p.connect(this.master);
    } else {
      g.connect(this.master);          // ältere Browser: mittig
    }
    return g;
  }

  // ------------------------------------------------------------ Bausteine

  /** Ein Ton mit Hüllkurve; from/to beschreiben den Tonhöhenverlauf. */
  tone(bus, at, { type = 'sine', from, to = from, dur = 0.2, gain = 0.2, attack = 0.005, filter = 0, q = 0 }) {
    const ctx = this.ctx;
    const f0 = Math.max(10, from * this._pitch), f1 = Math.max(10, to * this._pitch);
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = env(ctx, at, dur, gain, attack);
    o.connect(g);
    let tail = g;
    if (filter) {
      const bq = ctx.createBiquadFilter();
      bq.type = 'lowpass';
      bq.frequency.value = filter;
      if (q) bq.Q.value = q;
      g.connect(bq);
      tail = bq;
    }
    tail.connect(bus);
    o.start(at);
    o.stop(at + dur + 0.03);
  }

  /** Gefiltertes Rauschen - Explosionen, Triebwerke, Wind. */
  noise(bus, at, { dur = 0.3, type = 'lowpass', from = 1200, to = from, q = 1, gain = 0.2, attack = 0.005 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = true;
    const bq = ctx.createBiquadFilter();
    bq.type = type;
    bq.Q.value = q;
    const f0 = Math.max(20, from * this._pitch), f1 = Math.max(20, to * this._pitch);
    bq.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) bq.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = env(ctx, at, dur, gain, attack);
    src.connect(bq);
    bq.connect(g);
    g.connect(bus);
    src.start(at);
    src.stop(at + dur + 0.03);
  }

  /** Tonfolge im Abstand step. */
  seq(bus, at, freqs, step, opts) {
    freqs.forEach((f, i) => this.tone(bus, at + i * step, { ...opts, from: f, to: opts.to ?? f }));
  }

  noiseBuffer() {
    if (!this._noise) {
      const n = Math.floor(this.ctx.sampleRate * 0.8);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;
    }
    return this._noise;
  }
}

function env(ctx, at, dur, gain, attack) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + Math.min(attack, dur * 0.5));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  return g;
}

// --------------------------------------------------------------- Rezepte
// max/gap = Drosselung, vary = Tonhöhenstreuung.
const RECIPES = {
  // Oberfläche
  click: { max: 5, gap: 0.03, build: (s, b, t) => {
    s.tone(b, t, { type: 'triangle', from: 520, to: 430, dur: 0.045, gain: 0.05 });
    s.noise(b, t, { dur: 0.03, type: 'highpass', from: 2600, gain: 0.025 });
  } },
  select: { gap: 0.04, build: (s, b, t) => {
    s.tone(b, t, { type: 'sine', from: 620, to: 880, dur: 0.1, gain: 0.08 });
  } },
  selectFleet: { gap: 0.04, build: (s, b, t) => {
    s.tone(b, t, { type: 'triangle', from: 430, to: 560, dur: 0.11, gain: 0.07 });
    s.noise(b, t, { dur: 0.13, type: 'bandpass', from: 900, to: 1700, q: 2, gain: 0.05 });
  } },
  deselect: { gap: 0.04, build: (s, b, t) => {
    s.tone(b, t, { type: 'sine', from: 520, to: 380, dur: 0.08, gain: 0.045 });
  } },
  deny: { max: 2, build: (s, b, t) => {
    s.tone(b, t, { type: 'square', from: 190, to: 150, dur: 0.17, gain: 0.07, filter: 900 });
  } },
  chat: { max: 2, gap: 0.12, build: (s, b, t) => {
    s.seq(b, t, [659, 988], 0.06, { type: 'sine', dur: 0.12, gain: 0.05 });
  } },
  offline: { max: 1, build: (s, b, t) => {
    s.seq(b, t, [400, 300, 220], 0.12, { type: 'square', dur: 0.2, gain: 0.06, filter: 800 });
  } },

  // Befehle
  course: { max: 3, gap: 0.08, vary: 0.09, build: (s, b, t) => {
    s.noise(b, t, { dur: 0.34, type: 'lowpass', from: 300, to: 2800, q: 1.3, gain: 0.1, attack: 0.09 });
    s.tone(b, t, { type: 'sawtooth', from: 180, to: 760, dur: 0.3, gain: 0.05, filter: 1800 });
  } },
  ready: { max: 2, build: (s, b, t) => {
    s.seq(b, t, [587, 880], 0.085, { type: 'sine', dur: 0.2, gain: 0.1 });
  } },
  unready: { max: 2, build: (s, b, t) => {
    s.seq(b, t, [740, 494], 0.08, { type: 'sine', dur: 0.18, gain: 0.08 });
  } },

  // Rundenwechsel
  start: { max: 1, build: (s, b, t) => {
    s.tone(b, t, { type: 'sine', from: 60, to: 120, dur: 1.1, gain: 0.2, attack: 0.35 });
    s.seq(b, t + 0.25, [392, 523, 659], 0.1, { type: 'triangle', dur: 0.6, gain: 0.08 });
  } },
  turn: { max: 1, build: (s, b, t) => {
    s.tone(b, t, { type: 'sine', from: 92, to: 54, dur: 0.6, gain: 0.22 });
    s.noise(b, t, { dur: 0.5, type: 'lowpass', from: 420, to: 120, gain: 0.07 });
    s.seq(b, t + 0.06, [523, 659, 784], 0.055, { type: 'triangle', dur: 0.5, gain: 0.06 });
  } },

  // Rundenereignisse
  combat: { max: 3, gap: 0.14, vary: 0.16, build: (s, b, t) => {
    for (let i = 0; i < 3; i++) {                     // Laserschüsse
      s.tone(b, t + i * 0.05 + Math.random() * 0.02,
        { type: 'sawtooth', from: 2100 - i * 200, to: 620, dur: 0.08, gain: 0.05, filter: 3200 });
    }
    for (let i = 0; i < 3; i++) {                     // Einschläge
      const at = t + 0.06 + i * 0.09 + Math.random() * 0.04;
      s.noise(b, at, { dur: 0.3, type: 'lowpass', from: 1800, to: 180, q: 0.9, gain: 0.15 });
      s.tone(b, at, { type: 'square', from: 300 - i * 60, to: 70, dur: 0.22, gain: 0.06, filter: 1200 });
    }
  } },
  invade: { max: 2, gap: 0.2, build: (s, b, t) => {
    s.tone(b, t, { type: 'square', from: 110, to: 42, dur: 0.75, gain: 0.2, filter: 700 });
    s.noise(b, t, { dur: 0.8, type: 'lowpass', from: 900, to: 90, gain: 0.17, attack: 0.02 });
    s.seq(b, t + 0.12, [196, 147], 0.14, { type: 'sawtooth', dur: 0.4, gain: 0.06, filter: 900 });
  } },
  colonize: { max: 3, gap: 0.18, build: (s, b, t) => {
    s.seq(b, t, [523, 659, 784, 1046], 0.065, { type: 'triangle', dur: 0.4, gain: 0.08 });
    s.noise(b, t, { dur: 0.5, type: 'highpass', from: 3000, to: 6500, gain: 0.03, attack: 0.15 });
  } },
  settle: { max: 3, gap: 0.14, build: (s, b, t) => {
    s.seq(b, t, [523, 784], 0.07, { type: 'triangle', dur: 0.26, gain: 0.06 });
  } },
  build: { max: 3, gap: 0.11, vary: 0.09, build: (s, b, t) => {
    s.noise(b, t, { dur: 0.12, type: 'bandpass', from: 1400, q: 6, gain: 0.13 });
    s.tone(b, t, { type: 'square', from: 240, to: 180, dur: 0.1, gain: 0.07, filter: 1400 });
    s.noise(b, t + 0.1, { dur: 0.22, type: 'bandpass', from: 760, q: 4, gain: 0.08 });
    s.tone(b, t + 0.3, { type: 'triangle', from: 392, to: 523, dur: 0.18, gain: 0.05 });
  } },
  tech: { max: 2, gap: 0.25, build: (s, b, t) => {
    s.tone(b, t, { type: 'sine', from: 196, to: 392, dur: 0.6, gain: 0.06 });
    s.seq(b, t, [784, 988, 1175, 1568], 0.06, { type: 'sine', dur: 0.45, gain: 0.07 });
    s.noise(b, t + 0.05, { dur: 0.6, type: 'highpass', from: 4000, to: 9000, gain: 0.025, attack: 0.2 });
  } },
  terra: { max: 2, gap: 0.2, build: (s, b, t) => {
    s.noise(b, t, { dur: 0.6, type: 'bandpass', from: 400, to: 1800, q: 1.2, gain: 0.1, attack: 0.28 });
    s.tone(b, t, { type: 'sine', from: 220, to: 330, dur: 0.6, gain: 0.05 });
  } },
  arrive: { max: 3, gap: 0.09, build: (s, b, t) => {
    s.tone(b, t, { type: 'sine', from: 1175, to: 880, dur: 0.16, gain: 0.07 });
  } },
  warn: { max: 2, gap: 0.3, build: (s, b, t) => {
    s.seq(b, t, [880, 880], 0.12, { type: 'square', dur: 0.09, gain: 0.055, filter: 2400 });
  } },
  lost: { max: 2, gap: 0.25, build: (s, b, t) => {
    s.tone(b, t, { type: 'sine', from: 110, to: 70, dur: 0.9, gain: 0.12 });
    s.seq(b, t, [440, 349, 262], 0.13, { type: 'triangle', dur: 0.4, gain: 0.1 });
  } },
  eliminated: { max: 1, build: (s, b, t) => {
    s.tone(b, t, { type: 'sawtooth', from: 120, to: 48, dur: 1.5, gain: 0.15, filter: 500 });
    s.noise(b, t, { dur: 1.5, type: 'lowpass', from: 600, to: 80, gain: 0.1, attack: 0.12 });
  } },
  // Die Karte dehnt sich: ein weiter, aufgehender Klang
  expand: { max: 1, build: (s, b, t) => {
    s.tone(b, t, { type: 'sine', from: 110, to: 220, dur: 1.3, gain: 0.12, attack: 0.3 });
    s.noise(b, t, { dur: 1.1, type: 'bandpass', from: 300, to: 2600, q: 0.8, gain: 0.09, attack: 0.5 });
    s.seq(b, t + 0.25, [440, 659, 880, 1319], 0.13, { type: 'sine', dur: 0.7, gain: 0.055 });
  } },
  victory: { max: 1, build: (s, b, t) => {
    s.seq(b, t, [523, 659, 784, 1046], 0.11, { type: 'triangle', dur: 0.5, gain: 0.11 });
    s.tone(b, t + 0.45, { type: 'triangle', from: 523, dur: 1.3, gain: 0.08, attack: 0.03 });
    s.tone(b, t + 0.45, { type: 'sine', from: 1046, dur: 1.2, gain: 0.09, attack: 0.03 });
    s.tone(b, t + 0.45, { type: 'sine', from: 1318, dur: 1.2, gain: 0.07, attack: 0.03 });
  } }
};

/** Ereignistyp aus dem Rundenprotokoll -> Effekt. */
export const LOG_SFX = {
  combat: 'combat', invade: 'invade', colonize: 'colonize', settle: 'settle',
  build: 'build', tech: 'tech', terra: 'terra', arrive: 'arrive', warn: 'warn',
  galaxy: 'expand',
  lost: 'lost', eliminated: 'eliminated', victory: 'victory'
};

// ------------------------------------------------------------ Einstellungen
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s) return { on: s.on !== false, volume: typeof s.volume === 'number' ? s.volume : 0.7 };
  } catch {}
  return { on: true, volume: 0.7 };
}
function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify({ on: s.on, volume: s.volume })); } catch {}
}

export const sfx = new Sfx();

/**
 * Klick für alle Knöpfe an einer Stelle - und der erste Tastendruck oder Klick
 * weckt den Audiokontext, den der Browser sonst stummschaltet.
 */
export function bindUi() {
  const wake = () => sfx.start();
  addEventListener('pointerdown', wake, { once: true, capture: true });
  addEventListener('keydown', wake, { once: true, capture: true });
  addEventListener('pointerdown', (e) => {
    const b = e.target.closest?.('button');
    if (!b || b.disabled) return;
    if (b.dataset.sfx === 'none') return;     // eigener Klang an anderer Stelle
    sfx.play(b.dataset.sfx || 'click');
  }, true);
}
