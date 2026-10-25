import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { RedisIoAdapter } from "./realtime/redis-io.adapter";
import { resolveRuntimeConfig } from "./runtime-config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const runtimeConfig = resolveRuntimeConfig();
  app.enableCors({ origin: runtimeConfig.corsOrigins });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Comanda API")
    .setDescription("API de gestión gastronómica — catálogo, salón, pedidos, caja, sync offline y tiempo real")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  if (runtimeConfig.swaggerEnabled) {
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("docs", app, swaggerDocument);
  }

  const redisIoAdapter = new RedisIoAdapter(app, runtimeConfig.corsOrigins);
  const redisEnabled = await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);
  // eslint-disable-next-line no-console
  console.log(redisEnabled
    ? "redis enabled: realtime and rate limiting are shared across instances"
    : "REDIS_URL not set: using in-memory realtime and rate limiting (single instance only)");
  // eslint-disable-next-line no-console
  if (!runtimeConfig.mercadoPagoEnabled) console.log("Mercado Pago not configured: digital payment endpoints respond 503");

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`api listening on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  if (runtimeConfig.swaggerEnabled) console.log(`swagger docs at http://localhost:${port}/docs`);
}

bootstrap();