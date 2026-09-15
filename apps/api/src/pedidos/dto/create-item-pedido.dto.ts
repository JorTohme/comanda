import { IsInt, IsUUID, Min } from "class-validator";

export class CreateItemPedidoDto {
  @IsUUID()
  platoId!: string;

  @IsInt()
  @Min(1)
  cantidad!: number;
}
