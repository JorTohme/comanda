import { IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateSucursalDto {
  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
