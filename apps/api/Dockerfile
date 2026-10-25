# Build context: repo root.  docker build -f apps/api/Dockerfile -t comanda-api .
FROM node:20-alpine AS build
WORKDIR /app
# openssl must be present at generate time so Prisma picks the linux-musl-openssl-3.0.x engine.
RUN apk add --no-cache openssl && corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter api exec prisma generate \
 && pnpm --filter @comanda/shared build \
 && pnpm --filter api build
# Production-only install of api + @comanda/shared, then regenerate the Prisma client inside it.
RUN pnpm --filter api deploy --prod /out \
 && cd /out && ./node_modules/.bin/prisma generate

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
# Prisma engines need openssl on alpine.
RUN apk add --no-cache openssl
COPY --from=build --chown=node:node /out /app
RUN chmod +x docker-entrypoint.sh
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
