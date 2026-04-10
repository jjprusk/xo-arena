FROM node:22-alpine
WORKDIR /app/backend
ENV NODE_OPTIONS=--experimental-transform-types

# Build context = repo root
COPY backend/package.json ./
COPY packages/ai/ /app/packages/ai/
COPY packages/db/ /app/packages/db/

RUN npm install --no-package-lock --omit=dev --ignore-scripts

COPY backend/src/ ./src/

RUN npx prisma generate --schema=/app/packages/db/prisma/schema.prisma

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy --schema=/app/packages/db/prisma/schema.prisma && node src/index.js"]
