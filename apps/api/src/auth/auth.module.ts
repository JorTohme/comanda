import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { JwtService } from "./jwt.service";
import { RolesGuard } from "./roles.guard";

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [JwtService],
})
export class AuthModule {}
