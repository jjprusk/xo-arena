FROM node:22-alpine
WORKDIR /app/backend
ENV NODE_OPTIONS=--experimental-transform-types

# Copy package.json and vendored workspace packages
COPY package.json ./
COPY packages/ai/ ../packages/ai/
COPY packages/db/ ../packages/db/

RUN npm install --no-package-lock --omit=dev --ignore-scripts

# Copy backend source
COPY src/ ./src/

RUN npx prisma generate --schema=../packages/db/prisma/schema.prisma

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy --schema=../packages/db/prisma/schema.prisma && node src/index.js"]
