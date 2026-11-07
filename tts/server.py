"""The speech service: the game server sends a sentence, gets an MP3 back.

Lines with names in them ("Kepler Prime is ours, Olena.") cannot be recorded
in advance - this speaks them on demand. Runs next to the game server
(docker-compose.yml, service tts) and is only reachable from it.

  POST /speak   {"text": "...", "voice": "bm_george", "speed": 1.0, "keep": true}  -> audio/mpeg
  GET  /health  200 once the model is loaded

With "keep" (the game's fixed lines) the MP3 is kept in TTS_CACHE_DIR and
comes from there next time - a new game container is ready in seconds
instead of minutes. Lines with names are never kept here.

One sentence at a time (the model takes all cores anyway); when too many
wait, it says 503 and the game leaves that line out.
"""
import hashlib
import json
import os
import sys
import threading
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

from speech import Speaker

PORT = int(os.environ.get('TTS_PORT', '5005'))
MODEL = os.environ.get('TTS_MODEL_DIR', '/models')
MAX_WAITING = int(os.environ.get('TTS_MAX_WAITING', '6'))
MAX_TEXT = 300
CACHE = os.environ.get('TTS_CACHE_DIR', '')

speaker = Speaker(MODEL)
lock = threading.Lock()
waiting = 0
waiting_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass                                     # quiet; errors go to stderr below

    def reply(self, code, body=b'', ctype='text/plain'):
        self.send_response(code)
        self.send_header('content-type', ctype)
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.reply(200, b'ok') if self.path == '/health' else self.reply(404, b'404')

    def do_POST(self):
        global waiting
        if self.path != '/speak':
            return self.reply(404, b'404')
        try:
            size = int(self.headers.get('content-length', '0'))
            if size > 4096:
                return self.reply(413, b'too large')
            req = json.loads(self.rfile.read(size))
            text = str(req.get('text', '')).strip()
            voice = str(req.get('voice', ''))
            speed = float(req.get('speed', 1.0))
            keep = bool(req.get('keep', False)) and bool(CACHE)
        except (ValueError, TypeError):
            return self.reply(400, b'bad request')
        if not text or len(text) > MAX_TEXT or voice not in speaker.voices or not 0.5 <= speed <= 2:
            return self.reply(400, b'bad request')
        cached = None
        if keep:
            name = hashlib.sha256(f'{voice}|{speed:g}|{text}'.encode()).hexdigest()[:32] + '.mp3'
            cached = os.path.join(CACHE, name)
            try:
                with open(cached, 'rb') as f:
                    return self.reply(200, f.read(), 'audio/mpeg')
            except OSError:
                pass
        with waiting_lock:
            if waiting >= MAX_WAITING:
                return self.reply(503, b'busy')
            waiting += 1
        try:
            with lock:
                t0 = time.monotonic()
                audio = speaker.mp3(text, voice, speed)
                ms = round((time.monotonic() - t0) * 1000)
            print(f'{ms} ms  {voice}  {text[:60]}', file=sys.stderr, flush=True)
            if cached:
                try:
                    tmp = f'{cached}.{os.getpid()}.{threading.get_ident()}.tmp'
                    with open(tmp, 'wb') as f:
                        f.write(audio)
                    os.replace(tmp, cached)
                except OSError as e:
                    print(f'not kept: {e}', file=sys.stderr, flush=True)
            self.reply(200, audio, 'audio/mpeg')
        except Exception as e:                   # noqa: BLE001 - one bad sentence must not stop the service
            print(f'error: {e}', file=sys.stderr, flush=True)
            self.reply(500, b'error')
        finally:
            with waiting_lock:
                waiting -= 1


if __name__ == '__main__':
    if CACHE:
        os.makedirs(CACHE, exist_ok=True)
    kept = len([n for n in os.listdir(CACHE) if n.endswith('.mp3')]) if CACHE else 0
    print(f'Speech service on port {PORT}, {len(speaker.voices)} voices, {kept} lines kept.', file=sys.stderr, flush=True)
    ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
