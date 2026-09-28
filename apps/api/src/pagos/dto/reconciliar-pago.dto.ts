import { IsString, MinLength } from "class-validator";

export class ReconciliarPagoDto {
  @IsString()
  @MinLength(1)
  paymentId!: string;
}
