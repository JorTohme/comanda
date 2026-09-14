import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from "class-validator";

export class UpdatePlatoDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  nombre?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  precio?: number;

  @IsUUID()
  @IsOptional()
  categoriaId?: string;

  @IsOptional()
  @IsBoolean()
  disponible?: boolean;
}
