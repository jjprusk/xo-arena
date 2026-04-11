FROM node:22-alpine
WORKDIR /app
ENV NODE_OPTIONS=--experimental-transform-types

COPY package.json ./
COPY packages/ai/package.json ./packages/ai/
COPY packages/db/package.json ./packages/db/
COPY backend/package.json ./backend/
RUN npm install --workspace=backend --workspace=packages/ai --workspace=packages/db --no-package-lock --omit=dev --ignore-scripts

COPY packages/ai/ ./packages/ai/
COPY packages/db/ ./packages/db/
COPY backend/src/ ./backend/src/
COPY backend/prisma/ ./backend/prisma/
COPY backend/prisma.config.ts ./backend/

WORKDIR /app/backend
RUN npx prisma generate --schema=../packages/db/prisma/schema.prisma

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
