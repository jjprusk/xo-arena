# Build stage — runs from repo root context so packages/ai is accessible
FROM node:22-slim AS builder
WORKDIR /app
ENV NODE_OPTIONS=--experimental-transform-types
# Copy workspace manifests first for layer caching
COPY package.json ./
COPY packages/ai/package.json ./packages/ai/
COPY frontend/package.json ./frontend/
RUN npm install --workspace=frontend --workspace=packages/ai --no-package-lock --ignore-scripts
# Copy source
COPY packages/ai/ ./packages/ai/
COPY frontend/ ./frontend/
WORKDIR /app/frontend
ARG VITE_API_URL
ARG VITE_SOCKET_URL
ARG VITE_ENV
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL
ENV VITE_ENV=$VITE_ENV
RUN npm run build

# Runtime stage — only needs the static server (no workspace packages)
FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/frontend/dist ./dist
COPY --from=builder /app/frontend/server.js /app/frontend/package.json ./
RUN npm install --omit=dev --no-package-lock --ignore-scripts
EXPOSE 3000
CMD ["node", "server.js"]
