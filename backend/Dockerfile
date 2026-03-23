# ── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps

# ── Stage 2: build (generate Prisma client) ──────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npx prisma generate

# ── Stage 3: production image ─────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
# Copy Prisma client + CLI from build stage (CLI is a devDep, not in deps stage)
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY . .

EXPOSE 3000
# Run migrations then start the server (npx uses the locally-installed prisma CLI)
CMD ["sh", "-c", "npx --yes prisma migrate deploy && node src/index.js"]
