#!/usr/bin/env python3
"""Hear the radio lines before they go live.

Speaks the lines of server/radio/lines.json - and the templates, with example
names filled in - into a folder of MP3s, the way the speech service (tts/)
will speak them in the game. The game itself needs none of this: the server
has every line spoken by the service and caches it.

Needs:
  python3 -m venv .venv && .venv/bin/pip install -r tts/requirements.txt
  the model files kokoro-v1.0.onnx and voices-v1.0.bin from
  https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0)
  ffmpeg with libmp3lame

Run:
  .venv/bin/python tools/radio/preview.py --model DIR --out DIR [--speaker vulture|crew|crew2] [--event war]
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LINES = ROOT / 'server' / 'radio' / 'lines.json'
sys.path.insert(0, str(ROOT / 'tts'))

EXAMPLE = {'name': 'Admiral Wobblebeard', 'player': 'Olena', 'planet': 'Kepler Prime', 'ship': 'Nostromo'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True, help='directory with kokoro-v1.0.onnx and voices-v1.0.bin')
    ap.add_argument('--out', required=True, help='folder for the MP3s')
    ap.add_argument('--speaker', help='only this speaker')
    ap.add_argument('--event', help='only this event')
    args = ap.parse_args()

    from speech import Speaker
    speaker = Speaker(args.model)
    out = Path(args.out)
    spec = json.loads(LINES.read_text(encoding='utf-8'))['speakers']
    n = 0
    # A speaker with several voices (the crew) becomes crew1, crew2, ... as in the game.
    voiced = [(f'{name}{i + 1}' if s.get('voices') else name, base, s, v)
              for name, s in spec.items() for base in [name]
              for i, v in enumerate(s.get('voices') or [s['voice']])]
    for name, base, s, voice in voiced:
        if args.speaker and args.speaker not in (name, base):
            continue
        speed = s.get('speed', 1)
        if voice not in speaker.voices:
            sys.exit(f'{name}: unknown voice {voice}')
        groups = [('', s.get('lines', {})), ('named-', s.get('templates', {}))]
        for prefix, events in groups:
            for event, variants in events.items():
                if args.event and event != args.event:
                    continue
                for i, line in enumerate(variants, 1):
                    say = line['say'] if isinstance(line, dict) else line
                    say = re.sub(r'\{(\w+)\}', lambda m: EXAMPLE.get(m.group(1), m.group(1)), say)
                    dest = out / name / f'{prefix}{event}-{i}.mp3'
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(speaker.mp3(say, voice, speed))
                    n += 1
                    print(f'  {dest.relative_to(out)}  {say}', file=sys.stderr)
    print(f'{n} lines in {out}', file=sys.stderr)


if __name__ == '__main__':
    main()
