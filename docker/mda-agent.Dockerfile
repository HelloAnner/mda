FROM oven/bun:1.3.14-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/agent/package.json apps/agent/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY apps/control-plane/package.json apps/control-plane/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/dashboard-runtime/package.json packages/dashboard-runtime/package.json
COPY packages/dashboard-template/package.json packages/dashboard-template/package.json
RUN bun install --linker hoisted --frozen-lockfile --production --filter @mda/agent

FROM oven/bun:1.3.14-alpine
RUN apk add --no-cache bash git ripgrep
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY apps/agent/package.json ./apps/agent/package.json
COPY apps/agent/src ./apps/agent/src
COPY apps/agent/skills ./apps/agent/skills
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/contracts/src ./packages/contracts/src
COPY packages/dashboard-runtime/package.json ./packages/dashboard-runtime/package.json
COPY packages/dashboard-runtime/src ./packages/dashboard-runtime/src
COPY packages/dashboard-template/package.json ./packages/dashboard-template/package.json
COPY packages/dashboard-template/src ./packages/dashboard-template/src
COPY mda.example.toml ./mda.example.toml
RUN mkdir -p /workspace /home/bun/.cache && chown -R bun:bun /workspace /home/bun
USER bun
CMD ["bun", "apps/agent/src/worker.ts"]
