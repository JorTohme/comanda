import { Module } from "@nestjs/common";
import { CajaModule } from "../caja/caja.module";
import { MesasModule } from "../salon/mesas/mesas.module";
import { PedidosController } from "./pedidos.controller";
import { PedidosService } from "./pedidos.service";

@Module({
  imports: [MesasModule, CajaModule],
  controllers: [PedidosController],
  providers: [PedidosService],
  exports: [PedidosService],
})
export class PedidosModule {}
