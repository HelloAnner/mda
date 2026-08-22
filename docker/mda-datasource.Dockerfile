FROM oven/bun:1.3.14-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/agent/package.json apps/agent/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY apps/control-plane/package.json apps/control-plane/package.json
COPY apps/data-source-service/package.json apps/data-source-service/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/dashboard-runtime/package.json packages/dashboard-runtime/package.json
COPY packages/dashboard-template/package.json packages/dashboard-template/package.json
RUN bun install --frozen-lockfile --production --filter @mda/data-source-service

FROM oven/bun:1.3.14-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/apps/data-source-service/node_modules ./apps/data-source-service/node_modules
COPY --from=dependencies /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY apps/data-source-service/package.json ./apps/data-source-service/package.json
COPY apps/data-source-service/src ./apps/data-source-service/src
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/contracts/src ./packages/contracts/src
COPY migrations/data-source ./migrations/data-source
USER bun
CMD ["bun", "apps/data-source-service/src/server.ts"]
