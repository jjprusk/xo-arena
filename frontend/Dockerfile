FROM node:22-slim AS builder
WORKDIR /app/frontend

# Install deps (no workspace packages in package.json — xo resolved via Vite alias)
COPY package.json ./
RUN npm install --no-package-lock --ignore-scripts

# Copy vendored xo to /app/packages/xo so Vite alias '../packages/xo' resolves correctly
COPY packages/xo/ /app/packages/xo/

# Copy frontend source
COPY . .

RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/frontend/dist ./dist
COPY --from=builder /app/frontend/server.js /app/frontend/package.json ./
RUN npm install --omit=dev --no-package-lock --ignore-scripts
EXPOSE 4173
CMD ["node", "server.js"]
