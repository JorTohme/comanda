import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { CategoriasModule } from "./catalogo/categorias/categorias.module";
import { PlatosModule } from "./catalogo/platos/platos.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    CategoriasModule,
    PlatosModule,
  ],
})
export class AppModule {}
