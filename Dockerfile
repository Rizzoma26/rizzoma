# syntax=docker/dockerfile:1.7

FROM node:22.22.2-alpine AS api-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

FROM api-dependencies AS api-build
COPY tsconfig.base.json ./
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/src apps/api/src
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
COPY packages/contracts/src packages/contracts/src
COPY db db
RUN npm run build

FROM api-dependencies AS api-production-dependencies
RUN npm prune --omit=dev && npm cache clean --force

FROM node:22.22.2-alpine AS api
WORKDIR /app
ENV NODE_ENV=production PORT=8081
COPY --from=api-production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=api-production-dependencies --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=api-production-dependencies --chown=node:node /app/apps/api/package.json apps/api/package.json
COPY --from=api-production-dependencies --chown=node:node /app/packages/contracts/package.json packages/contracts/package.json
COPY --from=api-build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=api-build --chown=node:node /app/packages/contracts/dist packages/contracts/dist
COPY --from=api-build --chown=node:node /app/db/migrations db/migrations
USER node
EXPOSE 8081
CMD ["sh", "-c", "node apps/api/dist/db/migrate.js && exec node apps/api/dist/server.js"]

FROM node:22.22.2-alpine AS bot-dependencies
WORKDIR /app/bot
COPY bot/package.json bot/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22.22.2-alpine AS bot
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=bot-dependencies --chown=node:node /app/bot/node_modules bot/node_modules
COPY --chown=node:node bot/package.json bot/bot.js bot/storage.js bot/
COPY --chown=node:node economy.js engagement.js ./
USER node
EXPOSE 8080
CMD ["node", "bot/bot.js"]

FROM nginx:1.28-alpine AS web
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/config.js.template /etc/nginx/templates/config.js.template
COPY --chown=nginx:nginx index.html registration.js economy.js engagement.js logo.svg /usr/share/nginx/html/
COPY --chown=nginx:nginx legacy /usr/share/nginx/html/legacy
ENV NGINX_ENVSUBST_OUTPUT_DIR=/usr/share/nginx/html
RUN rm -f /etc/nginx/conf.d/default.conf && chown -R nginx:nginx /usr/share/nginx/html
USER nginx
EXPOSE 8080
