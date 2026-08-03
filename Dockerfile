FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
COPY tools/ ./tools/
COPY public/ ./public/
RUN node tools/build.js

FROM nginx:alpine
COPY --from=build /app/public/ /usr/share/nginx/html/
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
