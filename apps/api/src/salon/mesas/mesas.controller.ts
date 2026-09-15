import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { MesasService } from "./mesas.service";
import { CreateMesaDto } from "./dto/create-mesa.dto";
import { UpdateMesaDto } from "./dto/update-mesa.dto";

@Controller("mesas")
export class MesasController {
  // ponytail: explicit @Inject token — see categorias.controller.ts for why.
  constructor(@Inject(MesasService) private readonly mesasService: MesasService) {}

  @Post()
  create(@Body() dto: CreateMesaDto) {
    return this.mesasService.create(dto);
  }

  @Get()
  findAll() {
    return this.mesasService.findAll();
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateMesaDto) {
    return this.mesasService.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.mesasService.remove(id);
  }
}
