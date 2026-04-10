# Build stage — Docker build context is the repo root.
# Only the packages needed by the landing are copied in.
FROM node:22-slim AS builder
WORKDIR /app

# Install dependencies (npm workspace hoists all packages to /app/node_modules)
COPY package.json ./
COPY packages/xo/package.json ./packages/xo/
COPY landing/package.json ./landing/
RUN npm install --workspace=landing --no-package-lock

# Copy source
COPY packages/xo/ ./packages/xo/
COPY landing/ ./landing/

WORKDIR /app/landing
RUN npm run build

# Runtime stage — serve the built SPA + proxy upstream services
FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/landing/dist ./dist
COPY --from=builder /app/landing/server.js /app/landing/package.json ./
RUN npm install --omit=dev --no-package-lock --ignore-scripts
EXPOSE 4174
CMD ["node", "server.js"]
