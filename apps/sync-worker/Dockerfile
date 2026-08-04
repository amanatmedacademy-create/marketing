FROM node:22-alpine AS build
WORKDIR /app
COPY apps/sync-worker/package.json ./package.json
RUN npm install
COPY apps/sync-worker/tsconfig.json ./
COPY apps/sync-worker/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
USER node
COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
CMD ["node", "dist/main.js"]
