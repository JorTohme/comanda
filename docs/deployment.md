# Deployment

One small VM runs the API, PostgreSQL, Caddy (automatic HTTPS) and nightly backups with Docker Compose. Both frontends are static sites on Cloudflare Pages.

```
 Browser ──► Cloudflare Pages   apps/web (out/)      apps/operativa (dist/)
    │
    │ HTTPS + WebSocket (CORS_ORIGINS allow-list)
    ▼
 VM ── Caddy :80/:443 ──► api :3001 ──► postgres :5432 (internal network only)
                                         ▲
                          backup (pg_dump | gzip, nightly) ──► volume "backups"
```

Only Caddy publishes ports. The API and Postgres are reachable only inside the compose network.

## Prerequisites

- A VM with Docker and the Compose plugin, ports 80, 443/tcp and 443/udp open. Examples: Oracle Cloud Always Free, a ~EUR 6 Hetzner Cloud server. On a fresh Ubuntu VM, `sudo bash deploy/oracle-setup.sh` installs Docker and opens the host firewall (the cloud provider's own firewall, such as the Oracle VCN Security List, still has to allow the ports).
- A hostname for the API (your domain or a DuckDNS subdomain) with an A/AAAA record pointing at the VM. Caddy needs it to issue the certificate.
- A Cloudflare account for Pages.

## First deploy

```sh
git clone <repo-url> comanda && cd comanda
cp .env.production.example .env.production
```

Edit `.env.production`: set `API_DOMAIN`, `POSTGRES_PASSWORD` (`openssl rand -hex 24`, same value inside `DATABASE_URL`), `JWT_SECRET` (`openssl rand -base64 48`), and `CORS_ORIGINS` / `WEB_APP_URL` (see Cloudflare Pages below; you can deploy the API first and fix these afterwards). Redis and Mercado Pago variables stay commented out unless you need them.

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps
curl https://<API_DOMAIN>/health        # {"status":"ok"}
```

`--env-file` is required on every compose command: compose interpolates `${POSTGRES_PASSWORD}` and `${API_DOMAIN}` from it. The API container runs `prisma migrate deploy` on every start.

Create the first administrator (prints a one-time activation URL on `WEB_APP_URL`; share it manually):

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production exec api \
  node scripts/invite-admin.mjs --org "Restaurant" --branch "Central" --email owner@example.com
```

## Cloudflare Pages

Create two Pages projects from this repository (build from the repo root; Pages installs with pnpm from `packageManager`).

| Project | Build command | Output directory | Environment variable |
| --- | --- | --- | --- |
| web console | `pnpm install --frozen-lockfile && pnpm --filter @comanda/shared build && pnpm --filter web build` | `apps/web/out` | `NEXT_PUBLIC_API_URL=https://<API_DOMAIN>` |
| operativa PWA | `pnpm install --frozen-lockfile && pnpm --filter @comanda/shared build && pnpm --filter operativa build` | `apps/operativa/dist` | `VITE_API_URL=https://<API_DOMAIN>` |

Both values are public browser configuration and are inlined at build time: rebuild after changing them. Then set in `.env.production`:

- `CORS_ORIGINS=https://<web>.pages.dev,https://<operativa>.pages.dev` (HTTP and WebSocket allow-list, no trailing slash)
- `WEB_APP_URL=https://<web>.pages.dev`

and apply with `docker compose -f docker-compose.prod.yml --env-file .env.production up -d`.

## Mercado Pago (optional)

Without `MERCADOPAGO_ACCESS_TOKEN` the payment endpoints answer 503. To enable them, uncomment and set `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `MERCADOPAGO_MERCHANT_ID` and `PUBLIC_BASE_URL=https://<API_DOMAIN>` (all required together in production), restart the API, and register `https://<API_DOMAIN>/pagos/webhook` in Mercado Pago with the same signing secret.

## Updating and rollback

```sh
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Roll back by checking out the previous commit (or tag) and running the same command. Migrations are not rolled back: do not go back across a schema change without a reviewed rollback migration, and take a backup first.

## Backups and restore

The `backup` service dumps the database at start and then every 24 h to the `backups` volume as `comanda-YYYYMMDD-HHMMSS.sql.gz`, deleting dumps older than `BACKUP_RETENTION_DAYS` (default 14). Run one manually or list them:

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production exec backup /backup.sh
docker compose -f docker-compose.prod.yml --env-file .env.production exec backup ls -l /backups
```

Restore (replaces the current data; dumps include `DROP ... IF EXISTS`):

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production stop api
docker compose -f docker-compose.prod.yml --env-file .env.production exec backup \
  sh -c 'gunzip -c /backups/<file>.sql.gz | psql -v ON_ERROR_STOP=1'
docker compose -f docker-compose.prod.yml --env-file .env.production start api
```

Dumps live on the same VM. For off-site copies, copy the volume contents elsewhere (for example rclone to Cloudflare R2 from a host cron); this stack does not do it.

## Single-instance limits

With `REDIS_URL` unset, realtime (Socket.IO) and rate limiting are in memory, so run exactly one API container. To scale out, add a Redis service, set `REDIS_URL=redis://redis:6379` and run several API instances behind the proxy.

## CI

Protect `main` in GitHub and require the `CI / lint-build` and `CI / api-services` checks before merge.
