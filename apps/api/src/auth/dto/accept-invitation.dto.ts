import { IsString, MinLength } from "class-validator";

export class AcceptInvitationDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsString()
  @MinLength(1)
  nombre!: string;

  @IsString()
  @MinLength(12)
  password!: string;
}
