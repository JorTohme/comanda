import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { RedisIoAdapter } from "../src/realtime/redis-io.adapter";
import { resolveRuntimeConfig } from "../src/runtime-config";

// Single-VM mode: no Redis, no Mercado Pago.
describe("standalone boot without Redis and Mercado Pago", () => {
  const optional = ["REDIS_URL", "MERCADOPAGO_ACCESS_TOKEN", "MERCADOPAGO_WEBHOOK_SECRET", "MERCADOPAGO_MERCHANT_ID"];
  const saved: Record<string, string | undefined> = {};
  let app: INestApplication;
  let adapter: RedisIoAdapter;

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL ?? "");
    if (process.env.NODE_ENV !== "test" || database.pathname !== "/comanda_test" || database.port !== "55432") {
      throw new Error("Disposable localhost test database is required");
    }
    // Empty (not deleted) so ConfigModule does not reload apps/api/.env values.
    for (const name of optional) { saved[name] = process.env[name]; process.env[name] = ""; }
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    adapter = new RedisIoAdapter(app, resolveRuntimeConfig().corsOrigins);
    expect(await adapter.connectToRedis()).toBe(false);
    app.useWebSocketAdapter(adapter);
    await app.listen(0, "127.0.0.1");
  });

  afterAll(async () => {
    try { await app?.close(); } finally {
      await adapter?.close();
      for (const name of optional) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
    }
  });

  it("serves /health", async () => {
    const { port } = app.getHttpServer().address();
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });
});
