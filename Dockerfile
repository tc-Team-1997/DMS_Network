FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev --prefer-offline --no-audit

COPY . .

RUN mkdir -p uploads db && node db/seed.js

EXPOSE 3000

CMD ["node", "server.js"]
