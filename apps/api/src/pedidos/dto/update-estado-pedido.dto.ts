import { IsEnum } from "class-validator";
import { EstadoPedido } from "@prisma/client";

export class UpdateEstadoPedidoDto {
  @IsEnum(EstadoPedido)
  estado!: EstadoPedido;
}
