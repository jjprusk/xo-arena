# cache-bust: 2026-04-10
FROM node:22-alpine
WORKDIR /app
ENV NODE_OPTIONS=--experimental-transform-types
# Copy workspace manifests first for layer caching
COPY package.json ./
COPY packages/ai/package.json ./packages/ai/
COPY packages/db/package.json ./packages/db/
COPY backend/package.json ./backend/
RUN npm install --workspace=backend --no-package-lock --omit=dev --ignore-scripts
# Copy source
COPY packages/ai/ ./packages/ai/
COPY packages/db/ ./packages/db/
COPY backend/ ./backend/
WORKDIR /app/backend
RUN npx prisma generate --schema=../packages/db/prisma/schema.prisma
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy --schema=../packages/db/prisma/schema.prisma && node src/index.js"]
