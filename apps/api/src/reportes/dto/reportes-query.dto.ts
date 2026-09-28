import { Matches } from "class-validator";

export class ReportesQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  desde!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  hasta!: string;
}
