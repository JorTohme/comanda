import { Type } from "class-transformer";
import { ArrayNotEmpty, IsArray, IsEnum, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import { TipoServicio } from "@prisma/client";
import { CreateItemPedidoDto } from "./create-item-pedido.dto";

export class CreatePedidoDto {
  @IsEnum(TipoServicio)
  tipoServicio!: TipoServicio;

  @IsOptional()
  @IsUUID()
  mesaId?: string;

  @IsOptional()
  @IsString()
  plataforma?: string;

  @IsOptional()
  @IsString()
  direccionEnvio?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateItemPedidoDto)
  items!: CreateItemPedidoDto[];

  @IsOptional()
  @IsString()
  clientRequestId?: string;
}
