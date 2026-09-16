import { IsEnum, IsInt, IsNotEmpty, IsString, Min } from "class-validator";
import { TipoMovimientoCaja } from "@prisma/client";

export class CreateMovimientoDto {
  @IsEnum(TipoMovimientoCaja)
  tipo!: TipoMovimientoCaja;

  @IsInt()
  @Min(1)
  monto!: number;

  @IsString()
  @IsNotEmpty()
  descripcion!: string;
}
