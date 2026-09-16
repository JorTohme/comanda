import { IsEmail, IsEnum, IsNotEmpty, IsString, MinLength } from "class-validator";
import { RolUsuario } from "@prisma/client";

export class RegisterDto {
  @IsString() @IsNotEmpty() organizacionNombre!: string;
  @IsString() @IsNotEmpty() sucursalNombre!: string;
  @IsString() @IsNotEmpty() nombre!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(12) password!: string;
  @IsEnum(RolUsuario) rol: RolUsuario = RolUsuario.admin;
}
