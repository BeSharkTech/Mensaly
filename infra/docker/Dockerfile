# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build

WORKDIR /workspace
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/logger/package.json packages/logger/package.json
COPY packages/queue/package.json packages/queue/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/database/prisma packages/database/prisma
RUN --mount=type=cache,id=mensaly-pnpm-store,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store \
  && pnpm install --frozen-lockfile
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
RUN pnpm build

FROM node:22-bookworm-slim AS runtime

WORKDIR /workspace
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && groupadd --system mensaly \
  && useradd --system --gid mensaly --create-home mensaly
COPY --from=build --chown=mensaly:mensaly /workspace /workspace
USER mensaly
ENV NODE_ENV=production
STOPSIGNAL SIGTERM
CMD ["sh", "-c", "pnpm --filter @mensaly/$APP start"]
