FROM node:22-slim AS builder
WORKDIR /app

COPY package.json ./
COPY landing/package.json ./landing/
RUN npm install --workspace=landing --no-package-lock --ignore-scripts

# Shared packages — Vite aliases resolve '../packages/*' to /app/packages/*
COPY packages/xo/ ./packages/xo/
COPY packages/nav/ ./packages/nav/
COPY landing/ ./landing/

WORKDIR /app/landing
ARG VITE_XO_URL=https://xo.aiarena.callidity.com
ENV VITE_XO_URL=$VITE_XO_URL
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/landing/dist ./dist
COPY --from=builder /app/landing/server.js /app/landing/package.json ./
RUN npm install --omit=dev --no-package-lock --ignore-scripts
EXPOSE 4174
CMD ["node", "server.js"]
