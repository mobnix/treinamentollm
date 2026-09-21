# Imagem da LLM Warzone. Node LTS slim; better-sqlite3 compila no build.
FROM node:22-slim

WORKDIR /app

# Toolchain para o modulo nativo better-sqlite3.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public

# Banco em volume persistente.
RUN mkdir -p /app/data
ENV DB_PATH=/app/data/warzone.db
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
