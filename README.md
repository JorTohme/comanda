# Comanda

Monorepo de operación gastronómica: NestJS/PostgreSQL/Redis, consola Next.js y app operativa React/Vite.

## Aceptación de navegador

Usá Node.js 20 y la versión de pnpm fijada en `package.json` (`corepack pnpm@9.1.2`). La suite exige los servicios descartables de `docker-compose.test.yml`, migraciones y el seed demo:

```sh
docker compose -f docker-compose.test.yml up -d --wait
corepack pnpm install --frozen-lockfile
corepack pnpm --filter api exec prisma generate
corepack pnpm --filter api exec prisma migrate deploy
NODE_ENV=development ALLOW_DEMO_SEED=true corepack pnpm exec node apps/api/prisma/seed.mjs
corepack pnpm turbo run build
corepack pnpm exec playwright install chromium
corepack pnpm test:browser
```

En PowerShell, ejecutá el seed así:

```powershell
$env:NODE_ENV = "development"
$env:ALLOW_DEMO_SEED = "true"
corepack pnpm exec node apps/api/prisma/seed.mjs
```

El seed y la suite deben usar solamente el `comanda_test` local de los servicios descartables, nunca una base de negocio. Playwright usa los usuarios de prueba y datos demo documentados en [`SEED.md`](./SEED.md); los tests no abren Mercado Pago. CI configura salud de servicios, puertos, migraciones, tests y Chromium en un runner limpio.

Para usar otros puertos locales, configurá `BROWSER_API_URL`, `BROWSER_WEB_URL` y `BROWSER_OPERATIVA_URL` con los orígenes elegidos. Antes de ejecutar Playwright, compilá web y Operativa con la URL de API correspondiente (`NEXT_PUBLIC_API_URL` y `VITE_API_URL`).
