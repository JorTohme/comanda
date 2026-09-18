import { IsNotEmpty, IsString } from "class-validator";

export class CreateSucursalDto {
  @IsString()
  @IsNotEmpty()
  nombre!: string;
}
