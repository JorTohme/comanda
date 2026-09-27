import { IsIn } from "class-validator";

export class UpdateOcupacionMesaDto {
  @IsIn(["libre", "ocupada"])
  estado!: "libre" | "ocupada";
}
