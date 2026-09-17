import { IsUUID } from "class-validator";

export class CrearPreferenciaDto {
  @IsUUID()
  pedidoId!: string;
}
