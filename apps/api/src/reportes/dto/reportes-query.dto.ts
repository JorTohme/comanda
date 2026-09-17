import { IsDateString } from "class-validator";

export class ReportesQueryDto {
  @IsDateString()
  desde!: string;

  @IsDateString()
  hasta!: string;
}
