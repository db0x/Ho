# Ho!! - HTTP + WebSocket server, no build steps, one dependency (ws).
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Manifests first: this keeps the npm layer cached as long as the
# dependencies do not change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY shared ./shared
COPY server ./server
COPY client ./client
COPY test ./test

# Accounts live outside the image so a new image does not take them
# along. The directory belongs to the node user - otherwise
# "docker exec node server/users.js add ..." could not write to it.
ENV HO_USERS_FILE=/data/users.json
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 8080

CMD ["node", "server/index.js"]
