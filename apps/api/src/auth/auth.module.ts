import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { JwtService } from "./jwt.service";
import { RolesGuard } from "./roles.guard";
import { RedisThrottlerStorage } from "./redis-throttler.storage";

@Global()
@Module({
  imports: [ThrottlerModule.forRootAsync({ inject: [RedisThrottlerStorage], useFactory: (storage: RedisThrottlerStorage) => ({ storage, throttlers: [{ ttl: 60_000, limit: 120 }] }) })],
  controllers: [AuthController],
  providers: [
    RedisThrottlerStorage,
    AuthService,
    JwtService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [JwtService],
})
export class AuthModule {}
