import { Module } from "@nestjs/common";
import { PedidosModule } from "../pedidos/pedidos.module";
import { MercadoPagoClient } from "./mercadopago.client";
import { PagosController } from "./pagos.controller";
import { PagosService } from "./pagos.service";

@Module({
  imports: [PedidosModule],
  controllers: [PagosController],
  providers: [PagosService, MercadoPagoClient],
})
export class PagosModule {}
