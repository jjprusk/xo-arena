# Build stage — Docker build context is the repo root.
# Only the packages needed by the frontend are copied in.
# cache-bust: 2026-04-10
FROM node:22-slim AS builder
WORKDIR /app

# Install dependencies (npm workspace hoists all packages to /app/node_modules)
COPY package.json ./
COPY packages/xo/package.json ./packages/xo/
COPY frontend/package.json ./frontend/
RUN npm install --workspace=frontend --no-package-lock

# Copy source
COPY packages/xo/ ./packages/xo/
COPY frontend/ ./frontend/

WORKDIR /app/frontend

ARG VITE_API_URL
ARG VITE_SOCKET_URL
ARG VITE_ENV
ARG VITE_BASE_PATH
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL
ENV VITE_ENV=$VITE_ENV
ENV VITE_BASE_PATH=$VITE_BASE_PATH

RUN npm run build

# Runtime stage — serve the built SPA via server.js
FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/frontend/dist ./dist
COPY --from=builder /app/frontend/server.js /app/frontend/package.json ./
RUN npm install --omit=dev --no-package-lock --ignore-scripts
EXPOSE 3000
CMD ["node", "server.js"]
