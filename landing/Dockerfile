FROM node:22-slim AS builder
WORKDIR /app/landing

# Install deps (no workspace packages in package.json — xo resolved via Vite alias)
COPY package.json ./
RUN npm install --no-package-lock --ignore-scripts

# Copy vendored xo to /app/packages/xo so Vite alias '../packages/xo' resolves correctly
COPY packages/xo/ ../packages/xo/

# Copy landing source
COPY . .

RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/landing/dist ./dist
COPY --from=builder /app/landing/server.js /app/landing/package.json ./
RUN npm install --omit=dev --no-package-lock --ignore-scripts
EXPOSE 4174
CMD ["node", "server.js"]
