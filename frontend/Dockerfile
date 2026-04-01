# Build stage
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install --no-package-lock
COPY . .
ARG VITE_API_URL
ARG VITE_SOCKET_URL
ARG VITE_ENV
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL
ENV VITE_ENV=$VITE_ENV
RUN npm run build

# Runtime stage — only needs the static server
FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js /app/package.json ./
RUN npm install --omit=dev --no-package-lock --ignore-scripts
EXPOSE 3000
CMD ["node", "server.js"]
