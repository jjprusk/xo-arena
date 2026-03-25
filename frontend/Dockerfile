# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# Runtime stage
FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY server.js package.json ./
RUN npm install --omit=dev
EXPOSE 3000
CMD ["node", "server.js"]
