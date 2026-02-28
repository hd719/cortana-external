# syntax=docker/dockerfile:1.6
FROM node:22-alpine AS deps
WORKDIR /app

RUN corepack enable

COPY pnpm-workspace.yaml pnpm-lock.yaml ./
RUN --mount=type=bind,source=.,target=/src \
    if [ -f /src/package.json ]; then cp /src/package.json ./; fi
COPY apps/mission-control ./apps/mission-control
COPY packages ./packages

RUN pnpm install --frozen-lockfile --filter ./apps/mission-control...

FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=deps /app/apps ./apps
COPY --from=deps /app/packages ./packages

RUN pnpm -C apps/mission-control build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL= \
    CORTANA_DATABASE_URL=

COPY --from=build /app/apps/mission-control/.next/standalone ./
COPY --from=build /app/apps/mission-control/.next/static ./apps/mission-control/.next/static
COPY --from=build /app/apps/mission-control/public ./apps/mission-control/public

WORKDIR /app/apps/mission-control

EXPOSE 3000

CMD ["node", "server.js"]
