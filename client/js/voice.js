// Voice comms: push to talk, like CB radio. Hold the key, speak, let go -
// everyone on the comms hears it in real time, one speaker at a time.
//
// The audio runs directly from browser to browser (WebRTC, encrypted by
// DTLS-SRTP - there is no unencrypted mode). The server only passes on the
// connection setup once per pair and decides who holds the channel; it never
// sees a single sample. Without a relay some pairs cannot reach each other
// (mobile networks behind carrier NAT) - they show up as out of range.
//
// One link per other player, set up once and kept open: the key only
// switches the microphone track on, so speaking starts without delay.
//
// Who can listen: only the browsers at the ends of a link - DTLS checks the
// key of the other side against the fingerprint in its offer. The one weak
// spot is that this fingerprint travels via the server; a manipulated
// server could swap it and sit in the middle. Against that every client
// uses one key for all its links and shows a seal made from the keys of
// everyone on the radio: if all see the same symbols, nobody is in between.
//
// The CB radio is an option of the server (HO_VOICE), the game leader opens
// it per game, and it only exists with at least two people in the game.
import { t, hasKey } from './i18n.js';

const $ = s => document.querySelector(s);
// How long to collect connection candidates before the offer goes out:
// one message per pair instead of a dozen (the server throttles chatty
// connections), a little slower to set up.
const GATHER_MS = 2500;
const CONNECT_MS = 15000;
const BITRATE = 32000;               // Opus, plenty for a radio voice

export class Voice {
  /** @param {{send: Function}} app */
  constructor(app) {
    this.app = app;
    this.enabled = false;            // server option, from 'hello'
    this.stun = null;
    this.allowed = false;            // opened by the game leader
    this.cert = null;                // one DTLS key for all links of a switch-on
    this.fp = null;                  // ... and its fingerprint
    this.seal = null;
    this.view = null;
    this.on = false;
    this.stream = null;
    this.track = null;               // null: listening only
    this.nonce = null;               // our current switch-on, from the server
    this.peers = [];                 // [{id, n}] on the comms
    this.floor = null;               // who holds the channel
    this.wantTalk = false;           // key held down
    this.joining = false;            // switch-on sent, not confirmed yet
    this.links = new Map();          // playerId -> link
    this.ctx = null;
    this.bind();
  }

  configure(cfg) {
    this.enabled = !!cfg;
    this.stun = cfg?.stun ?? null;
  }

  iceServers() {
    if (!this.stun) return [];
    const url = typeof this.stun === 'string' ? this.stun
      : `stun:${location.hostname.includes(':') ? `[${location.hostname}]` : location.hostname}:${this.stun.port}`;
    return [{ urls: url }];
  }

  // ------------------------------------------------------------------ UI
  // In the game there is just the microphone button next to the chat input,
  // and only while the radio is on. Everything else - switching on, opening
  // it for the game, the key, the seal, who is on - lives behind the gear.
  bind() {
    $('#chk-voice').onchange = (e) => (e.target.checked ? this.enable() : this.disable());
    $('#chk-voice-allow').onchange = (e) => this.app.send({ t: 'voiceAllow', on: e.target.checked });
    const ptt = $('#voice-ptt');
    ptt.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      ptt.setPointerCapture?.(e.pointerId);
      this.press();
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) ptt.addEventListener(ev, () => this.release());
    ptt.addEventListener('contextmenu', (e) => e.preventDefault());       // long press on phones

    this.key = loadKey();
    $('#voice-key').onclick = () => {
      this.pickingKey = true;
      this.paint();
    };
    addEventListener('keydown', (e) => {
      if (this.pickingKey) {
        e.preventDefault(); e.stopPropagation();
        this.pickingKey = false;
        if (e.code !== 'Escape' && !RESERVED.includes(e.key.toLowerCase()) && e.code) {
          this.key = { code: e.code, label: e.key.length === 1 ? e.key.toUpperCase() : null };
          saveKey(this.key);
        }
        this.paint();
        return;
      }
      // A key that writes text is text while a text field has the focus.
      if (e.repeat || e.code !== this.key.code || (e.key.length === 1 && typing(e.target))) return;
      if (!this.on || $('#screen-game').classList.contains('hidden')) return;
      e.preventDefault();
      this.press();
    }, true);
    addEventListener('keyup', (e) => { if (e.code === this.key.code) this.release(); });
    addEventListener('blur', () => this.release());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.release(); });
    this.paint();
  }

  paint() {
    const v = this.view;
    const player = id => v?.players.find(p => p.id === id);
    const isHost = !!v && v.host === v.you;
    const supported = !!(navigator.mediaDevices && window.RTCPeerConnection && crypto.subtle);

    // The microphone button: there while the radio is on.
    const ptt = $('#voice-ptt');
    const other = this.floor && this.floor !== v?.you ? player(this.floor) : null;
    ptt.classList.toggle('hidden', !this.on || !this.track);
    ptt.classList.toggle('talking', this.floor === v?.you && this.wantTalk);
    ptt.classList.toggle('busy', !!other);
    ptt.style.setProperty('--c', other?.color || '');
    ptt.title = other ? t('voice.sending', { player: other.name }) : t('voice.talkTitle', { key: keyName(this.key) });
    // Who is on air shows where the eye is anyway: in the input field.
    const input = $('#chat-input');
    input.placeholder = other ? t('voice.sending', { player: other.name })
      : this.floor === v?.you && this.on ? t('voice.you') : t('chat.placeholder');

    // Settings behind the gear.
    $('#row-voice-allow').classList.toggle('hidden', !isHost);
    $('#chk-voice-allow').checked = this.allowed;
    const me = $('#chk-voice');
    me.checked = this.on;
    me.disabled = !supported || (!this.allowed && !this.on);
    $('#voice-key').textContent = this.pickingKey ? t('voice.keyPress') : keyName(this.key);
    $('#voice-key').classList.toggle('picking', !!this.pickingKey);
    let note = '';
    if (!supported) note = t('voice.unavailable');
    else if (!this.allowed) note = t(isHost ? 'voice.closedHost' : 'voice.closed');
    else if (this.on && !this.track) note = t('voice.noMic');
    else if (this.on && !this.links.size) note = t('voice.alone');
    $('#voice-note').textContent = note;
    $('#voice-note').classList.toggle('hidden', !note);

    $('#voice-seal').classList.toggle('hidden', !this.on || !this.links.size);
    $('#voice-seal-code').textContent = this.seal || t('voice.sealPending');

    const host = $('#voice-peers');
    host.replaceChildren(...[...this.links].map(([id, link]) => {
      // Shows who is on the radio - nobody can be taken off it from here.
      const chip = document.createElement('span');
      chip.className = `voice-peer ${link.state}${this.floor === id ? ' live' : ''}`;
      chip.style.setProperty('--c', player(id)?.color || '#888');
      chip.textContent = player(id)?.name ?? '?';
      chip.title = t(`voice.peer.${link.state}`);
      return chip;
    }));
  }

  /** Only players (no spectators) in a running game with two people or more. */
  setView(view) {
    this.view = view;
    const usable = this.enabled && !view.spectator && view.state === 'running'
      && view.players.filter(p => !p.isBot).length >= 2;
    $('#voice-opts').classList.toggle('hidden', !usable);
    if (!usable && this.on) this.disable();
    this.paint();
  }

  // ------------------------------------------------------------ switching
  async enable() {
    if (this.on || !this.allowed || !navigator.mediaDevices || !window.RTCPeerConnection || !crypto.subtle) return this.paint();
    this.on = true;
    this.joining = true;              // not before the microphone is settled
    this.audio();                     // inside the click: browsers allow sound now
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      });
      this.track = this.stream.getAudioTracks()[0];
      this.track.enabled = false;     // silent until the channel is ours
    } catch {
      this.stream = null; this.track = null;      // no microphone: listen only
    }
    // A fresh key per switch-on, the same for all links - that is what
    // makes the seal comparable.
    try {
      this.cert = await RTCPeerConnection.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256' });
      this.fp = this.cert.getFingerprints?.().find(f => f.algorithm === 'sha-256')?.value.toUpperCase() ?? null;
    } catch { this.cert = null; this.fp = null; }
    if (!this.on) return this.stopMic();          // switched off while asking
    if (!this.cert || !this.fp) { this.on = false; this.stopMic(); this.paint(); return; }
    this.joining = true;
    this.app.send({ t: 'voice', on: true });
    this.paint();
  }

  /** The connection to the server broke: it will not remember us. */
  lost() {
    this.release();
    this.joining = false;
    this.floor = null;
    this.carrier(false);
  }

  disable() {
    if (!this.on) return;
    this.on = false;
    this.joining = false;
    this.release();
    this.app.send({ t: 'voice', on: false });
    for (const id of [...this.links.keys()]) this.drop(id);
    this.stopMic();
    this.nonce = null;
    this.cert = null; this.fp = null; this.seal = null;
    this.paint();
  }

  stopMic() {
    for (const tr of this.stream?.getTracks() || []) tr.stop();
    this.stream = null; this.track = null;
  }

  // -------------------------------------------------------- push to talk
  press() {
    if (!this.on || this.wantTalk) return;
    if (!this.track || (this.floor && this.floor !== this.view?.you)) { this.fx('deny'); return; }
    this.wantTalk = true;
    this.app.send({ t: 'ptt', on: true });
    this.paint();
  }

  release() {
    if (!this.wantTalk) return;
    this.wantTalk = false;
    if (this.track) this.track.enabled = false;
    if (this.floor === this.view?.you) this.app.send({ t: 'ptt', on: false });
    this.paint();
  }

  // ------------------------------------------------------- server state
  /** 'voice' from the server: who is on the comms, who holds the channel. */
  onState(msg) {
    const you = this.view?.you;
    const before = this.floor;
    this.allowed = !!msg.allowed;
    // Closed by the game leader: the server has taken everyone off already.
    if (!this.allowed && this.on) this.disable();
    this.peers = msg.peers || [];
    this.floor = msg.floor ?? null;
    this.nonce = this.peers.find(p => p.id === you)?.n ?? null;
    if (this.nonce) this.joining = false;
    // Back after a lost connection (or on a new socket): the server has
    // forgotten us - switch on again, the links are set up anew.
    else if (this.on && !this.joining) {
      this.joining = true;
      this.app.send({ t: 'voice', on: true });
    }

    if (this.on) {
      if (this.wantTalk && this.floor && this.floor !== you) { this.wantTalk = false; this.fx('deny'); }
      // Let go before the channel arrived: hand it straight back.
      if (this.floor === you && !this.wantTalk) this.app.send({ t: 'ptt', on: false });
      if (this.track) this.track.enabled = this.floor === you && this.wantTalk;
      if (before !== this.floor) {
        if (before && before !== you) this.fx('roger');
        if (this.floor === you && this.wantTalk) this.fx('key');
        else if (this.floor && this.floor !== you) this.fx('open');
        this.carrier(!!this.floor && this.floor !== you);
      }
      this.sync();
    }
    this.paint();
  }

  /** Bring the links in line with who is on the comms. */
  sync() {
    const you = this.view?.you;
    if (!this.nonce) return;                     // our switch-on not confirmed yet
    const humans = new Set((this.view?.players || []).filter(p => !p.isBot).map(p => p.id));
    const wanted = new Map(this.peers.filter(p => p.id !== you && humans.has(p.id)).map(p => [p.id, p.n]));
    for (const [id, link] of this.links) {
      if (wanted.get(id) !== link.n || link.mine !== this.nonce) this.drop(id);
    }
    for (const [id, n] of wanted) if (!this.links.has(id)) this.link(id, n);
  }

  // ---------------------------------------------------------------- links
  link(id, n) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers(), certificates: [this.cert] });
    const gain = this.ctx.createGain();
    gain.connect(this.voiceBus);
    const link = { id, n, mine: this.nonce, pc, gain, state: 'connecting', restarted: false, el: null, fp: null };
    this.links.set(id, link);
    if (this.track) {
      const sender = pc.addTrack(this.track, this.stream);
      const params = sender.getParameters();
      if (params.encodings?.length) { params.encodings[0].maxBitrate = BITRATE; sender.setParameters(params).catch(() => {}); }
    } else pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.ontrack = (e) => this.play(link, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') { link.state = 'ok'; clearTimeout(link.timer); }
      else if (s === 'failed') this.failed(link);
      else if (s === 'disconnected') link.state = 'connecting';
      this.paint();
    };
    link.timer = setTimeout(() => { if (link.state !== 'ok') { link.state = 'far'; this.paint(); } }, CONNECT_MS);
    // The lower id makes the offer, the other one answers - no collisions.
    if (this.offerer(id)) this.offer(link);
  }

  offerer(id) { return String(this.view?.you) < String(id); }

  async offer(link, iceRestart = false) {
    try {
      await link.pc.setLocalDescription(await link.pc.createOffer({ iceRestart }));
      await gathered(link.pc);
      this.signal(link, { type: 'offer', sdp: link.pc.localDescription.sdp });
    } catch (e) { console.warn('voice offer', e); this.failed(link); }
  }

  /** A pair that does not get through: one fresh try, then out of range. */
  failed(link) {
    if (this.links.get(link.id) !== link) return;
    if (!link.restarted && this.offerer(link.id)) { link.restarted = true; this.offer(link, true); return; }
    link.state = 'far';
    this.paint();
  }

  signal(link, data) {
    if (this.links.get(link.id) !== link) return;
    this.app.send({ t: 'rtc', to: link.id, data: { ...data, sdp: withDtx(data.sdp), tn: link.n } });
  }

  /** 'rtc' from the server: an offer or answer from another player. */
  async onSignal(msg) {
    const link = this.links.get(msg.from);
    const d = msg.data || {};
    // Only for this switch-on, from the switch-on we know: old devices and
    // stray messages do not get in.
    if (!this.on || !link || link.n !== msg.n || d.tn !== this.nonce || typeof d.sdp !== 'string') return;
    // The key the other side will have to prove in the DTLS handshake.
    const fp = fingerprint(d.sdp);
    if (!fp) return;
    link.fp = fp;
    this.updateSeal();
    try {
      if (d.type === 'offer' && !this.offerer(link.id)) {
        await link.pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
        await link.pc.setLocalDescription(await link.pc.createAnswer());
        await gathered(link.pc);
        this.signal(link, { type: 'answer', sdp: link.pc.localDescription.sdp });
      } else if (d.type === 'answer' && this.offerer(link.id)) {
        await link.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
      }
    } catch (e) { console.warn('voice signal', e); this.failed(link); }
  }

  /**
   * The seal: a hash over the keys of everyone on the radio as this browser
   * sees them. Swapping a key in the middle changes it on the affected side
   * only - so it no longer matches the others. 6 symbols out of 64 (36 bit):
   * too many to fake by trying keys during a game.
   */
  async updateSeal() {
    const links = [...this.links.values()];
    if (!this.fp || !links.length || links.some(l => !l.fp)) { this.seal = null; this.paint(); return; }
    const input = this.sealInput();
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ho-cb-seal|' + input)));
    if (input !== this.sealInput()) return;       // changed meanwhile - the newer call paints
    const symbols = [];
    for (let i = 0, bits = 0, n = 0; symbols.length < SEAL_LEN; i++) {
      bits = ((bits << 8) | hash[i]) & 0xffff; n += 8;
      while (n >= 6 && symbols.length < SEAL_LEN) { n -= 6; symbols.push(SEAL[(bits >> n) & 63]); }
    }
    this.seal = symbols.join(' ');
    this.paint();
  }

  /** Every key on the radio as this browser sees it, in a fixed order. */
  sealInput() {
    const links = [...this.links.values()];
    return [[String(this.view?.you), this.fp], ...links.map(l => [l.id, l.fp])]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(e => e.join('=')).join('|');
  }

  drop(id) {
    const link = this.links.get(id);
    if (!link) return;
    this.links.delete(id);
    this.updateSeal();
    clearTimeout(link.timer);
    link.pc.close();
    link.src?.disconnect();
    link.gain.disconnect();
    if (link.el) { link.el.srcObject = null; link.el.remove(); }
  }

  // ---------------------------------------------------------------- sound
  /**
   * Audio graph: every incoming voice through the radio filter (narrow band,
   * a little crunch), plus squelch noise and roger beep made up locally.
   */
  audio() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      const c = this.ctx;
      const out = c.createGain();
      out.gain.value = 1;
      out.connect(c.destination);
      this.out = out;
      // The radio sound: telephone band and soft clipping.
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 380;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2700;
      const peak = c.createBiquadFilter(); peak.type = 'peaking'; peak.frequency.value = 1500; peak.gain.value = 6;
      const crunch = c.createWaveShaper(); crunch.curve = softClip(3.5); crunch.oversample = '2x';
      const level = c.createGain(); level.gain.value = 1.4;
      this.voiceBus = c.createGain();
      this.voiceBus.connect(hp); hp.connect(peak); peak.connect(lp); lp.connect(crunch); crunch.connect(level); level.connect(out);
      // Carrier hiss while someone else holds the channel.
      this.hiss = c.createGain(); this.hiss.gain.value = 0;
      const n = c.createBufferSource(); n.buffer = noiseBuffer(c); n.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.6;
      n.connect(bp); bp.connect(this.hiss); this.hiss.connect(out); n.start();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  play(link, stream) {
    // Chrome only lets a remote stream flow into Web Audio while a media
    // element plays it - muted, the sound comes from the graph.
    if (!link.el) {
      link.el = document.createElement('audio');
      link.el.muted = true; link.el.autoplay = true; link.el.playsInline = true;
      document.body.appendChild(link.el);
    }
    link.el.srcObject = stream;
    link.el.play?.().catch(() => {});
    link.src?.disconnect();
    link.src = this.ctx.createMediaStreamSource(stream);
    link.src.connect(link.gain);
  }

  carrier(on) {
    if (!this.hiss) return;
    const g = this.hiss.gain, at = this.ctx.currentTime;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(on ? 0.035 : 0, at, on ? 0.02 : 0.05);
  }

  /** Short radio noises: key up, channel opens, roger beep, busy. */
  fx(kind) {
    if (!this.ctx) return;
    const c = this.ctx, at = c.currentTime + 0.01;
    const tone = (f, start, dur, gain = 0.12, type = 'square') => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0, at + start);
      g.gain.linearRampToValueAtTime(gain, at + start + 0.005);
      g.gain.setValueAtTime(gain, at + start + dur - 0.01);
      g.gain.linearRampToValueAtTime(0, at + start + dur);
      o.connect(g); g.connect(this.voiceBus);
      o.start(at + start); o.stop(at + start + dur + 0.02);
    };
    const burst = (start, dur, gain = 0.25) => {
      const s = c.createBufferSource(), g = c.createGain();
      s.buffer = noiseBuffer(c);
      g.gain.setValueAtTime(gain, at + start);
      g.gain.exponentialRampToValueAtTime(0.001, at + start + dur);
      s.connect(g); g.connect(this.voiceBus);
      s.start(at + start); s.stop(at + start + dur);
    };
    if (kind === 'key') { burst(0, 0.06, 0.12); tone(1400, 0.02, 0.05, 0.05, 'sine'); }
    if (kind === 'open') burst(0, 0.12, 0.3);
    if (kind === 'roger') { tone(1250, 0, 0.09); tone(950, 0.09, 0.11); burst(0.2, 0.18, 0.3); }
    if (kind === 'deny') { tone(320, 0, 0.12, 0.1, 'sawtooth'); tone(320, 0.17, 0.12, 0.1, 'sawtooth'); }
  }
}

/**
 * Asks the other side for DTX: in silence (key not pressed) Opus sends next
 * to nothing instead of a steady stream of empty packets - with 15 links
 * that would otherwise be a constant upload on a phone for nothing.
 */
function withDtx(sdp) {
  return sdp.replace(/^(a=fmtp:\d+ (?![^\r\n]*usedtx)[^\r\n]*useinbandfec=1[^\r\n]*)/m, '$1;usedtx=1');
}

/** Is a key going into a text field? Then it is text, not the talk key. */
function typing(el) {
  if (el?.isContentEditable || el?.tagName === 'TEXTAREA') return true;
  return el?.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(el.type);
}

// The push-to-talk key, chosen in the settings and kept in this browser.
// By default the right Ctrl: it writes nothing, so it also works while the
// chat field has the focus, and the game uses it for nothing else. Keys the
// game already uses cannot be taken.
const KEY_STORE = 'ho-ptt-key';
const DEFAULT_KEY = { code: 'ControlRight', label: null };
const RESERVED = [' ', 'enter', 'escape', 'tab', 'f', 'p', 't', 'h', '+', '-'];
function loadKey() {
  try { const k = JSON.parse(localStorage.getItem(KEY_STORE) || 'null'); if (k?.code) return k; } catch {}
  return DEFAULT_KEY;
}
function saveKey(k) {
  try { localStorage.setItem(KEY_STORE, JSON.stringify(k)); } catch {}
}
/** A letter as it is printed on the key, other keys by name in the current language. */
function keyName(k) {
  if (k.label) return k.label;
  return hasKey('key.' + k.code) ? t('key.' + k.code) : k.code.replace(/^(Key|Digit)/, '');
}

// Symbols of the seal: easy to tell apart and to name over the radio.
const SEAL = [...'🚀🌙⭐🪐🛰👽🤖👾🐙🦊🐼🐸🦉🐢🦋🐝🐬🦈🐳🦀🌵🌲🍀🌻🍄🍎🍋🍇🍒🥕🌽🍕🍩🧀🎲🎸🎺🥁🎯🏆⚓🔔🔑💎🧭⛵🚲🚂🏰🗿🌋🌈🔥💧🎈🎁🧲🪁🦄🐧🍉🥨🎩🌮'];
const SEAL_LEN = 6;

/** The sha-256 fingerprint of the DTLS key named in an offer or answer. */
function fingerprint(sdp) {
  return /^a=fingerprint:sha-256 ([0-9A-F:]{95})\r?$/im.exec(sdp)?.[1].toUpperCase() ?? null;
}

/** Waits until the browser has its connection candidates - or the time is up. */
function gathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((ok) => {
    const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); ok(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const timer = setTimeout(done, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

function softClip(k) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
  return curve;
}

let noise = null;
function noiseBuffer(c) {
  if (noise && noise.sampleRate === c.sampleRate) return noise;
  noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}
