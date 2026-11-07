// Radio chatter of the AI colonies and the aliens: what they say lives in
// lines.json, the speech service speaks it (tts.js) and the browser fetches
// each line on demand, only when signed in.
//
//   GET /api/radio/list                    the fixed lines: speaker -> event -> [{file, text, v}]
//   GET /api/radio/tts/<key>.mp3?v=<key>   one spoken line
//
// A fixed line that is not cached yet is spoken right then; a line with
// names only exists once the server had it spoken for a transmission. Any
// other key: 404. Without the speech service: 503, and the radio is silent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ttsFile, ttsKey, registerFixed, fixedLine, speak, ttsEnabled } from './tts.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = '/api/radio/';

let speakers = null, lines = null;

/** speaker -> {voice, speed, lines: {event: [line]}, templates: {event: [template]}} - read once. */
export function radioVoices() {
  if (!speakers) {
    try { speakers = JSON.parse(fs.readFileSync(path.join(DIR, 'lines.json'), 'utf8')).speakers || {}; } catch (e) {
      console.error('Radio lines not readable:', e.message);
      speakers = {};
    }
  }
  return speakers;
}

/**
 * The fixed lines: speaker -> event -> [{say, text, voice, speed, key, file}].
 * say is what is spoken, text the subtitle (the aliens' gibberish has one of its own).
 * A speaker with several voices (the crew) becomes one speaker per voice:
 * crew1, crew2, ... - all with the same lines.
 */
export function radioManifest() {
  if (!lines) {
    lines = {};
    const voiced = Object.entries(radioVoices()).flatMap(([speaker, s]) => s.voices?.length
      ? s.voices.map((voice, i) => [`${speaker}${i + 1}`, { ...s, voice }])
      : [[speaker, s]]);
    for (const [speaker, s] of voiced) {
      lines[speaker] = {};
      const voice = s.voice, speed = s.speed ?? 1;
      for (const [event, variants] of Object.entries(s.lines || {})) {
        lines[speaker][event] = variants.map(l => {
          const say = typeof l === 'string' ? l : l.say;
          const key = ttsKey(say, voice, speed);
          return { say, text: typeof l === 'string' ? l : (l.text ?? l.say), voice, speed, key, file: `tts/${key}.mp3` };
        });
      }
    }
    // The crew answers clicks right away - its lines are prepared first.
    registerFixed(Object.entries(lines).flatMap(([speaker, ev]) => Object.values(ev).flat()
      .map(l => ({ text: l.say, voice: l.voice, speed: l.speed, first: speaker.startsWith('crew') }))));
  }
  return lines;
}

/** What the debug dialog needs to know of the fixed lines. */
function list() {
  const out = {};
  for (const [speaker, events] of Object.entries(radioManifest())) {
    out[speaker] = {};
    for (const [event, clips] of Object.entries(events)) {
      out[speaker][event] = clips.map(c => ({ file: c.file, text: c.text, v: c.key }));
    }
  }
  return out;
}

export function handleRadio(req, res, urlPath) {
  if (!urlPath.startsWith(PREFIX)) return false;
  const name = urlPath.slice(PREFIX.length);
  radioManifest();
  const fail = (code, text) => res.writeHead(code, { 'content-type': 'text/plain' }).end(text);
  if (req.method !== 'GET' && req.method !== 'HEAD') { fail(404, '404'); return true; }
  if (name === 'list') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
      .end(JSON.stringify(list()));
    return true;
  }
  const m = /^tts\/([0-9a-f]{20})\.mp3$/.exec(name);
  const file = m && ttsFile(m[1]);
  if (!file) { fail(404, '404'); return true; }
  const serve = () => fs.readFile(file, (err, data) => {
    if (err) { fail(404, '404'); return; }
    res.writeHead(200, {
      'content-type': 'audio/mpeg', 'x-content-type-options': 'nosniff',
      // The key is the content: the same address always holds the same sentence.
      'cache-control': 'private, max-age=31536000, immutable'
    }).end(data);
  });
  if (fs.existsSync(file)) { serve(); return true; }
  // Not spoken yet: a fixed line may be spoken now - nothing else.
  const line = fixedLine(m[1]);
  if (!line) { fail(404, '404'); return true; }
  if (!ttsEnabled()) { fail(503, 'no speech service'); return true; }
  speak(line.text, line.voice, line.speed).then(serve, () => fail(503, 'speech service unavailable'));
  return true;
}
