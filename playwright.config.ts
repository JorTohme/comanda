import { defineConfig } from "@playwright/test";

const apiUrl = "http://localhost:3001";
const webUrl = "http://localhost:3000";
const operativaUrl = "http://localhost:5173";
const databaseUrl = "postgresql://comanda:comanda@localhost:55432/comanda_test?schema=public";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: operativaUrl,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "corepack pnpm --filter api start",
      url: `${apiUrl}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        REDIS_URL: "redis://localhost:56379",
        JWT_SECRET: "ci-only-secret-not-for-production",
        CORS_ORIGINS: "http://localhost:3000,http://localhost:5173",
        MERCADOPAGO_ACCESS_TOKEN: "ci-placeholder",
        MERCADOPAGO_WEBHOOK_SECRET: "ci-placeholder",
        MERCADOPAGO_MERCHANT_ID: "777",
        PUBLIC_BASE_URL: apiUrl,
        WEB_APP_URL: webUrl,
        PORT: "3001",
      },
    },
    {
      command: "corepack pnpm --filter web start",
      url: webUrl,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { NODE_ENV: "production", PORT: "3000", NEXT_PUBLIC_API_URL: apiUrl },
    },
    {
      command: "corepack pnpm --filter operativa exec vite preview --host 127.0.0.1 --port 5173 --strictPort",
      url: operativaUrl,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { NODE_ENV: "production", VITE_API_URL: apiUrl },
    },
  ],
});
