# Multi-stage build for the ClassOps v2 API/migration image.
# Same image serves both roles (see compose.v2.prod.yml): the `api` service runs the default
# CMD, the `migrate` service overrides it to run the one-shot migration script.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S classops && adduser -S classops -G classops
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
USER classops
EXPOSE 3000
CMD ["node", "dist/index.js"]
