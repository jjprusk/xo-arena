# Build stage
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --no-package-lock
COPY . .
RUN npm run build

# Runtime stage — serve the built SPA + proxy upstream services
FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js /app/package.json ./
RUN npm install --omit=dev --no-package-lock --ignore-scripts
EXPOSE 4174
CMD ["node", "server.js"]
