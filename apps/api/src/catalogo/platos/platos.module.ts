import { Module } from "@nestjs/common";
import { PlatosController } from "./platos.controller";
import { PlatosService } from "./platos.service";

@Module({
  controllers: [PlatosController],
  providers: [PlatosService],
})
export class PlatosModule {}
