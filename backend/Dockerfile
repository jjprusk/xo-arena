FROM node:22-alpine
WORKDIR /app
ENV NODE_OPTIONS=--experimental-transform-types
COPY package.json ./
RUN npm install --no-package-lock --omit=dev
COPY . .
RUN npx prisma generate
EXPOSE 3000
