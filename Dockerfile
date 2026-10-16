# Ho!! - HTTP + WebSocket-Server, keine Build-Schritte, eine Abhaengigkeit (ws).
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Erst nur die Manifeste: so bleibt der npm-Layer im Cache, solange sich die
# Abhaengigkeiten nicht aendern.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY shared ./shared
COPY server ./server
COPY client ./client
COPY test ./test

USER node
EXPOSE 8080

CMD ["node", "server/index.js"]
