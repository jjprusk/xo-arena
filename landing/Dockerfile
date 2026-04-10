FROM node:22-slim AS builder
WORKDIR /app/landing

# Build context = repo root
COPY landing/package.json ./
RUN npm install --no-package-lock --ignore-scripts

# Shared package — Vite alias resolves '../packages/xo' to /app/packages/xo
COPY packages/xo/ /app/packages/xo/

# Landing source
COPY landing/ ./

RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/landing/dist ./dist
COPY --from=builder /app/landing/server.js /app/landing/package.json ./
RUN npm install --omit=dev --no-package-lock --ignore-scripts
EXPOSE 4174
CMD ["node", "server.js"]
