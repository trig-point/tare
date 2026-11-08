FROM node:22-bookworm-slim AS base

FROM base AS tools
ENV CI=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@11.2.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/engine/package.json packages/engine/package.json
COPY packages/health-sources/package.json packages/health-sources/package.json
COPY packages/nutrition/package.json packages/nutrition/package.json
COPY packages/order-parser/package.json packages/order-parser/package.json
COPY apps/web/package.json apps/web/package.json

FROM tools AS build
RUN pnpm install --frozen-lockfile
COPY packages/engine packages/engine
COPY packages/health-sources packages/health-sources
COPY packages/nutrition packages/nutrition
COPY packages/order-parser packages/order-parser
COPY apps/web apps/web
RUN pnpm build

FROM tools AS production
RUN pnpm install --prod --frozen-lockfile
RUN npm exec --yes --package=node-gyp@10.3.1 -- node-gyp rebuild --release --force_build=1 --directory=packages/engine/node_modules/better-sqlite3
RUN rm -rf packages/engine/node_modules/better-sqlite3/prebuilds
COPY packages/engine/src packages/engine/src
COPY packages/engine/migrations packages/engine/migrations
COPY packages/health-sources/src packages/health-sources/src
COPY packages/nutrition/src packages/nutrition/src
COPY packages/order-parser/src packages/order-parser/src
WORKDIR /app/packages/engine
RUN node --input-type=module -e "await import('@tare/health-sources'); await import('@tare/nutrition'); await import('@tare/order-parser'); const { openDatabase } = await import('./src/db.ts'); const connection = openDatabase(':memory:'); connection.close()"

FROM base AS runtime
ENV NODE_ENV=production \
    DATABASE_URL=/data/tare.sqlite \
    PORT=3000 \
    TARE_TIMEZONE=UTC \
    TARE_BACKUP_DIR=/backups \
    TARE_BACKUP_KEEP=7
COPY --from=production --chown=node:node /app /app
COPY --from=build --chown=node:node /app/apps/web/dist /app/apps/web/dist
RUN mkdir -p /data /backups && chown node:node /data /backups
WORKDIR /app/packages/engine
USER node
VOLUME ["/data", "/backups"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(response => process.exit(response.status === 200 ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "src/index.ts"]
