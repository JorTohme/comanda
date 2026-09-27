import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { MercadoPagoClient } from "../src/pagos/mercadopago.client";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisIoAdapter } from "../src/realtime/redis-io.adapter";

export async function createTestApp(provider?: Partial<MercadoPagoClient>): Promise<{
  app: INestApplication;
  prisma: PrismaService;
  close(): Promise<void>;
}> {
  const database = new URL(process.env.DATABASE_URL ?? "");
  const redis = new URL(process.env.REDIS_URL ?? "");
  if (process.env.NODE_ENV !== "test" || database.pathname !== "/comanda_test" ||
    !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "55432" ||
    !["localhost", "127.0.0.1"].includes(redis.hostname) || redis.port !== "56379") {
    throw new Error("Disposable localhost test database and Redis are required");
  }

  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (provider) builder.overrideProvider(MercadoPagoClient).useValue(provider);
  const module = await builder.compile();
  const app = module.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const adapter = new RedisIoAdapter(app);
  try {
    await adapter.connectToRedis();
    app.useWebSocketAdapter(adapter);
    await app.listen(0, "127.0.0.1");
    return {
      app,
      prisma: app.get(PrismaService),
      close: async () => {
        try { await app.close(); } finally { await adapter.close(); }
      },
    };
  } catch (error) {
    try { await app.close(); } finally { await adapter.close(); }
    throw error;
  }
}
