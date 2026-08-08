FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY tools/ ./tools/
COPY public/ ./public/
RUN node tools/build.js

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY db.js server.js ./
COPY tools/analytics.js ./tools/analytics.js
COPY --from=build /app/public ./public

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

CMD ["node", "server.js"]

