# --- Backend API + WebSocket server ---
FROM node:22-alpine

WORKDIR /app

# Install deps first for better layer caching.
COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=4000
ENV DB_PATH=/data/app.db

EXPOSE 4000

# Persist SQLite in a named volume mounted at /data.
VOLUME ["/data"]

CMD ["node", "src/index.js"]
