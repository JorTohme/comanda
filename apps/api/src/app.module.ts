import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { CategoriasModule } from "./catalogo/categorias/categorias.module";
import { PlatosModule } from "./catalogo/platos/platos.module";
import { HealthModule } from "./health/health.module";
import { PedidosModule } from "./pedidos/pedidos.module";
import { PrismaModule } from "./prisma/prisma.module";
import { MesasModule } from "./salon/mesas/mesas.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    HealthModule,
    CategoriasModule,
    PlatosModule,
    MesasModule,
    PedidosModule,
  ],
})
export class AppModule {}
