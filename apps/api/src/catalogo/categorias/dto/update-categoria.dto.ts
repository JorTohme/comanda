import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class UpdateCategoriaDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  nombre?: string;
}
