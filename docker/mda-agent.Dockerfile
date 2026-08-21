FROM oven/bun:1.3.14-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/agent/package.json apps/agent/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY apps/control-plane/package.json apps/control-plane/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN bun install --frozen-lockfile --production --filter @mda/agent

FROM oven/bun:1.3.14-alpine
RUN apk add --no-cache bash git ripgrep
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/apps/agent/node_modules ./apps/agent/node_modules
COPY --from=dependencies /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY apps/agent/src ./apps/agent/src
COPY apps/agent/skills ./apps/agent/skills
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/contracts/src ./packages/contracts/src
COPY mda.example.toml ./mda.example.toml
RUN mkdir -p /workspace /home/bun/.cache && chown -R bun:bun /workspace /home/bun
USER bun
CMD ["bun", "apps/agent/src/worker.ts"]
