import { IsInt, Min } from "class-validator";

export class AbrirTurnoDto {
  @IsInt()
  @Min(0)
  montoInicial!: number;
}
