# Vercel and Railway deployment

## Railway API

Create one Railway service from this repository plus managed PostgreSQL and Redis. Railway uses `apps/api/Dockerfile`; `railway.toml` runs Prisma migrations before the API starts and checks `/health`.

Set API secrets only in Railway: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `MERCADOPAGO_ACCESS_TOKEN`, and `MERCADOPAGO_WEBHOOK_SECRET`. Set public configuration there too: `NODE_ENV=production`, `PUBLIC_BASE_URL`, `WEB_APP_URL`, and comma-separated `CORS_ORIGINS`. Use the generated Railway domain as `PUBLIC_BASE_URL`; include both Vercel domains in `CORS_ORIGINS`.

## Vercel frontends

Create two Vercel projects from the same repository:

- `apps/web`: set `NEXT_PUBLIC_API_URL` to the Railway API URL.
- `apps/operativa`: set `VITE_API_URL` to the Railway API URL.

These values are public browser configuration, never credentials. Copy their generated domains into Railway `CORS_ORIGINS` and set the web domain as `WEB_APP_URL` so activation links land on `/invitacion`.

## GitHub delivery gate

Protect `main` in GitHub and require the `CI / lint-build` and `CI / api-services` checks before merge. Connect Vercel and Railway to the repository and deploy only `main`; pull requests receive provider previews but must not receive production secrets.

## First administrator and rollback

After migrations succeed, issue the first owner link from a controlled shell with Railway variables:

```sh
pnpm --filter api invite-admin -- --org "Restaurant" --branch "Central" --email owner@example.com
```

Share the resulting URL manually. Register `${PUBLIC_BASE_URL}/pagos/webhook` in Mercado Pago with the configured signing secret. To roll back, redeploy the preceding successful Railway/Vercel release; do not roll back a database migration without a reviewed rollback migration.
