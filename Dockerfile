# ── Stage 1: build frontend ───────────────────────────────────────────────────
FROM node:22-slim AS frontend-builder
WORKDIR /frontend
COPY frontend/package.json ./
RUN npm install --no-package-lock
COPY frontend/ ./
# VITE_API_URL intentionally omitted — same-origin in production
# VITE_SOCKET_URL intentionally omitted — same-origin in production
ARG VITE_ENV
ENV VITE_ENV=$VITE_ENV
RUN npm run build

# ── Stage 2: backend runtime ───────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
ENV NODE_OPTIONS=--experimental-transform-types
COPY backend/package.json ./
RUN npm install --no-package-lock --omit=dev
COPY backend/ ./
RUN npx prisma generate
# Embed built frontend — served by Express as static files
COPY --from=frontend-builder /frontend/dist ./public
EXPOSE 3000
