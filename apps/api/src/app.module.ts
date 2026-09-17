import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { CajaModule } from "./caja/caja.module";
import { CategoriasModule } from "./catalogo/categorias/categorias.module";
import { PlatosModule } from "./catalogo/platos/platos.module";
import { HealthModule } from "./health/health.module";
import { PedidosModule } from "./pedidos/pedidos.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { MesasModule } from "./salon/mesas/mesas.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    RealtimeModule,
    HealthModule,
    CategoriasModule,
    PlatosModule,
    MesasModule,
    PedidosModule,
    CajaModule,
  ],
})
export class AppModule {}
