import { IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from "class-validator";
import { EstadoMesa } from "@prisma/client";

export class CreateMesaDto {
  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @IsInt()
  @Min(1)
  capacidad!: number;

  @IsOptional()
  @IsEnum(EstadoMesa)
  estado?: EstadoMesa;

  @IsOptional()
  @IsNumber()
  posX?: number;

  @IsOptional()
  @IsNumber()
  posY?: number;

  @IsOptional()
  @IsNumber()
  rotacion?: number;

  @IsOptional()
  @IsIn(["rect", "circle"])
  forma?: string;

  @IsOptional()
  @IsNumber()
  ancho?: number;

  @IsOptional()
  @IsNumber()
  alto?: number;
}
