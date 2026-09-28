import { Module } from "@nestjs/common";
import { CajaModule } from "../caja/caja.module";
import { MesasModule } from "../salon/mesas/mesas.module";
import { PedidosController } from "./pedidos.controller";
import { PedidosService } from "./pedidos.service";
import { CobrosService } from "./cobros.service";

@Module({
  imports: [MesasModule, CajaModule],
  controllers: [PedidosController],
  providers: [PedidosService, CobrosService],
  exports: [PedidosService, CobrosService],
})
export class PedidosModule {}
