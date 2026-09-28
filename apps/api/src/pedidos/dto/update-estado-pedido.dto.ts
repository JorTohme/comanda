import { IsEnum, IsInt, Min } from "class-validator";
import { EstadoPedido } from "@prisma/client";

export class UpdateEstadoPedidoDto {
  @IsEnum(EstadoPedido)
  estado!: EstadoPedido;

  @IsInt()
  @Min(0)
  expectedVersion!: number;
}
