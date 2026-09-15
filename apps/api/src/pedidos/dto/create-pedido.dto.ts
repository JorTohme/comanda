import { Type } from "class-transformer";
import { ArrayNotEmpty, IsArray, IsEnum, IsOptional, IsUUID, ValidateNested } from "class-validator";
import { TipoServicio } from "@prisma/client";
import { CreateItemPedidoDto } from "./create-item-pedido.dto";

export class CreatePedidoDto {
  @IsEnum(TipoServicio)
  tipoServicio!: TipoServicio;

  @IsOptional()
  @IsUUID()
  mesaId?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateItemPedidoDto)
  items!: CreateItemPedidoDto[];
}
