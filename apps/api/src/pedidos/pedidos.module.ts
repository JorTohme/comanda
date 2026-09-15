import { Module } from "@nestjs/common";
import { MesasModule } from "../salon/mesas/mesas.module";
import { PedidosController } from "./pedidos.controller";
import { PedidosService } from "./pedidos.service";

@Module({
  imports: [MesasModule],
  controllers: [PedidosController],
  providers: [PedidosService],
})
export class PedidosModule {}
