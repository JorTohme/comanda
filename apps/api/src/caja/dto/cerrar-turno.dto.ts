import { IsInt, Min } from "class-validator";

export class CerrarTurnoDto {
  @IsInt()
  @Min(0)
  montoDeclarado!: number;
}
