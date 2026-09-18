import { IsOptional, IsString, IsUUID, MinLength } from "class-validator";

export class RefreshDto {
  @IsString() @MinLength(1) refreshToken!: string;
  @IsOptional() @IsUUID() sucursalIdHint?: string;
}
