# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Temel: pnpm kurulu Node 22
# ---------------------------------------------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && apk add --no-cache libc6-compat openssl tzdata
ENV TZ=Europe/Istanbul
WORKDIR /app

# ---------------------------------------------------------------------------
# Bağımlılıklar (manifest'ler önce → katman önbelleği)
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY packages/config/package.json ./packages/config/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Geliştirme: hot reload, kaynak bind mount edilir
# ---------------------------------------------------------------------------
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
RUN pnpm --filter @sy/db run generate
EXPOSE 3001
CMD ["pnpm", "--filter", "@sy/api", "run", "dev"]

# ---------------------------------------------------------------------------
# Derleme
# ---------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
RUN pnpm --filter @sy/db run generate \
 && pnpm --filter @sy/api run build \
 && pnpm deploy --filter @sy/api --prod --legacy /app/pruned

# ---------------------------------------------------------------------------
# Üretim
# ---------------------------------------------------------------------------
FROM base AS production
ENV NODE_ENV=production
COPY --from=build /app/pruned/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/packages/db/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY docker/api-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && mkdir -p /app/storage
EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/main.js"]
