FROM node:22-alpine AS base

WORKDIR /app
ENV NODE_ENV=production

FROM base AS build

COPY package.json package-lock.json ./
RUN npm install

FROM base AS production

COPY --from=build /app/node_modules ./node_modules
COPY . .

CMD ["npm", "start"]