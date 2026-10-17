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

# Die Konten liegen ausserhalb des Images, damit ein neues Abbild sie nicht
# mitnimmt. Das Verzeichnis gehoert dem Benutzer node - sonst koennte
# "docker exec node server/users.js add ..." nicht schreiben.
ENV HO_USERS_FILE=/data/users.json
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 8080

CMD ["node", "server/index.js"]
