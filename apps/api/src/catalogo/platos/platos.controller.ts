import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { PlatosService } from "./platos.service";
import { CreatePlatoDto } from "./dto/create-plato.dto";
import { UpdatePlatoDto } from "./dto/update-plato.dto";

@Controller("platos")
export class PlatosController {
  constructor(private readonly platosService: PlatosService) {}

  @Post()
  create(@Body() dto: CreatePlatoDto) {
    return this.platosService.create(dto);
  }

  @Get()
  findAll(@Query("categoriaId") categoriaId?: string) {
    return this.platosService.findAll(categoriaId);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdatePlatoDto) {
    return this.platosService.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.platosService.remove(id);
  }
}
