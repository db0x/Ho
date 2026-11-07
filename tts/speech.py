"""Text to a dry, radio-ready MP3 with Kokoro (Apache-2.0, runs locally).

Shared by the speech service (tts/server.py) and the preview of the lines
(tools/radio/preview.py), so both sound exactly alike. The radio sound
itself is added in the browser (client/js/audio/radio.js).
"""
import subprocess
from pathlib import Path

# Trim the silence at both ends and bring every clip to the same loudness,
# then mono MP3 - every browser decodes it (Ogg/Opus not every Safari).
FILTER = ('silenceremove=start_periods=1:start_threshold=-45dB,areverse,'
          'silenceremove=start_periods=1:start_threshold=-45dB,areverse,'
          'loudnorm=I=-16:TP=-1.5:LRA=11')


class Speaker:
    def __init__(self, model_dir):
        from kokoro_onnx import Kokoro
        model = Path(model_dir)
        self.kokoro = Kokoro(str(model / 'kokoro-v1.0.onnx'), str(model / 'voices-v1.0.bin'))
        self.voices = set(self.kokoro.get_voices())

    def mp3(self, text, voice, speed=1.0):
        """The spoken text as MP3 bytes."""
        import io
        import soundfile as sf
        samples, rate = self.kokoro.create(text, voice=voice, speed=speed, lang='en-us')
        wav = io.BytesIO()
        sf.write(wav, samples, rate, format='WAV')
        return subprocess.run(
            ['ffmpeg', '-v', 'error', '-f', 'wav', '-i', 'pipe:0', '-af', FILTER,
             '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '48k', '-f', 'mp3', 'pipe:1'],
            input=wav.getvalue(), check=True, capture_output=True).stdout
