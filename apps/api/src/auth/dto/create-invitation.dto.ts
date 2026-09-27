import { IsEmail, IsIn, IsUUID } from "class-validator";
import { RolUsuario } from "@prisma/client";

export class CreateInvitationDto {
  @IsEmail()
  email!: string;

  @IsUUID()
  sucursalId!: string;

  @IsIn(["caja", "mozo", "cocina"])
  rol!: RolUsuario;
}
