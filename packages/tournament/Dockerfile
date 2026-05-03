FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/ai/package.json ./packages/ai/
COPY packages/db/package.json ./packages/db/
COPY packages/tournament/package.json ./packages/tournament/

RUN npm ci --workspace=packages/ai --workspace=packages/db --workspace=packages/tournament --ignore-scripts

COPY packages/ai/ ./packages/ai/
COPY packages/db/ ./packages/db/
COPY packages/tournament/ ./packages/tournament/

RUN npx prisma generate --schema=./packages/db/prisma/schema.prisma

# NOTE: This service does NOT run prisma migrate deploy — the backend service is the sole migration authority.

EXPOSE 3001
CMD ["node", "--experimental-transform-types", "packages/tournament/src/index.js"]
