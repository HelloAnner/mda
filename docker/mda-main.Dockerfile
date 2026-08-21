FROM oven/bun:1.3.14-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/agent/package.json apps/agent/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY apps/control-plane/package.json apps/control-plane/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN bun install --frozen-lockfile --production --filter @mda/control-plane

FROM oven/bun:1.3.14-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/apps/control-plane/node_modules ./apps/control-plane/node_modules
COPY --from=dependencies /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY apps/control-plane/package.json ./apps/control-plane/package.json
COPY apps/control-plane/src ./apps/control-plane/src
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/contracts/src ./packages/contracts/src
COPY migrations/control-plane ./migrations/control-plane
COPY mda.example.toml ./mda.example.toml
USER bun
EXPOSE 8080
CMD ["bun", "apps/control-plane/src/server.ts"]
