import { IsInt, IsUUID, Max, Min } from "class-validator";

export class CreateItemPedidoDto {
  @IsUUID()
  platoId!: string;

  @IsInt()
  @Min(1)
  @Max(999)
  cantidad!: number;
}
