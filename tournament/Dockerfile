FROM node:22-alpine
WORKDIR /app
ENV NODE_OPTIONS=--experimental-transform-types
COPY package.json ./
COPY packages/db/package.json ./packages/db/
COPY tournament/package.json ./tournament/
RUN npm install --workspace=tournament --workspace=packages/db --no-package-lock --omit=dev --ignore-scripts
COPY packages/db/ ./packages/db/
COPY tournament/ ./tournament/
WORKDIR /app/tournament
RUN npx prisma generate --schema=../packages/db/prisma/schema.prisma
EXPOSE 3001
CMD ["node", "src/index.js"]
