FROM node:22-alpine
WORKDIR /app
ENV NODE_OPTIONS=--experimental-transform-types

# Copy workspace manifests + the root lockfile for deterministic
# transitive resolution. Without the lockfile, workspace installs
# silently drop deep deps (e.g. bullmq's tslib / msgpackr) and the
# image only fails at runtime when the affected module is imported.
COPY package.json package-lock.json ./
COPY packages/ai/package.json ./packages/ai/
COPY packages/db/package.json ./packages/db/
COPY backend/package.json ./backend/
RUN npm install --workspace=backend --workspace=packages/ai --workspace=packages/db --omit=dev --ignore-scripts

COPY packages/ai/ ./packages/ai/
COPY packages/db/ ./packages/db/
COPY backend/src/ ./backend/src/
COPY backend/prisma/ ./backend/prisma/
COPY backend/prisma.config.ts ./backend/

# Help corpus markdown files — seedHelpCorpus() reads /app/doc/Help_Corpus
# on every boot and inserts new slugs into HelpDoc.
COPY doc/Help_Corpus/ ./doc/Help_Corpus/

WORKDIR /app/backend
RUN npx prisma generate --schema=../packages/db/prisma/schema.prisma

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
