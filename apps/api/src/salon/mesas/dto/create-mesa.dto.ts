import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from "class-validator";
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
}
