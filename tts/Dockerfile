# Ho!! speech service: Kokoro (Apache-2.0) speaks the radio lines with names
# in them. Only the game server talks to it (docker-compose.yml, service tts).
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The model, pinned by checksum: a changed file must not slip in unnoticed.
ARG MODELS=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
RUN mkdir /models \
 && curl -fsSL -o /models/kokoro-v1.0.onnx $MODELS/kokoro-v1.0.onnx \
 && curl -fsSL -o /models/voices-v1.0.bin $MODELS/voices-v1.0.bin \
 && echo "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5  /models/kokoro-v1.0.onnx" | sha256sum -c - \
 && echo "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d  /models/voices-v1.0.bin" | sha256sum -c -

COPY speech.py server.py ./

# The game's fixed lines stay here (a volume in docker-compose.yml), so a
# fresh start does not have to speak them all again.
RUN useradd --system --no-create-home tts && mkdir /cache && chown tts /cache
ENV TTS_CACHE_DIR=/cache
VOLUME /cache
USER tts
EXPOSE 5005
CMD ["python", "-u", "server.py"]
