# Builds the v2 static frontend and serves it, same-origin with the API, behind nginx.
# Build from the repository root: docker build -f ops/gateway/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV VITE_AUTH_MODE=v2
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY ops/gateway/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
