FROM node:22-slim AS builder
WORKDIR /app

COPY package.json ./
COPY frontend/package.json ./frontend/
RUN npm install --workspace=frontend --no-package-lock --ignore-scripts

# Shared packages — Vite aliases resolve '../packages/*' to /app/packages/*
COPY packages/xo/ ./packages/xo/
COPY packages/nav/ ./packages/nav/
COPY frontend/ ./frontend/

WORKDIR /app/frontend
ARG VITE_LANDING_URL
ENV VITE_LANDING_URL=$VITE_LANDING_URL
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/frontend/dist ./dist
COPY --from=builder /app/frontend/server.js /app/frontend/package.json ./
RUN npm install --omit=dev --no-package-lock --ignore-scripts
EXPOSE 4173
CMD ["node", "server.js"]
