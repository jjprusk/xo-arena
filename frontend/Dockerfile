FROM node:22-slim AS builder
WORKDIR /app/frontend

# Build context = repo root
COPY frontend/package.json ./
RUN npm install --no-package-lock --ignore-scripts

# Shared package — Vite alias resolves '../packages/xo' to /app/packages/xo
COPY packages/xo/ /app/packages/xo/

# Frontend source
COPY frontend/ ./

RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/frontend/dist ./dist
COPY --from=builder /app/frontend/server.js /app/frontend/package.json ./
RUN npm install --omit=dev --no-package-lock --ignore-scripts
EXPOSE 4173
CMD ["node", "server.js"]
