import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from "class-validator";

export class CreatePlatoDto {
  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @IsInt()
  @Min(0)
  precio!: number;

  @IsUUID()
  categoriaId!: string;

  @IsOptional()
  @IsBoolean()
  disponible?: boolean;
}
