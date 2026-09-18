import { IsUUID } from "class-validator";

export class SwitchSucursalDto {
  @IsUUID()
  sucursalId!: string;
}
