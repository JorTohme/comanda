import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { CategoriasService } from "./categorias.service";
import { CreateCategoriaDto } from "./dto/create-categoria.dto";
import { UpdateCategoriaDto } from "./dto/update-categoria.dto";

@Controller("categorias")
export class CategoriasController {
  // ponytail: explicit @Inject token — tsx/esbuild's dev runtime doesn't emit
  // TS decorator metadata, so DI can't fall back to design:paramtypes here.
  constructor(@Inject(CategoriasService) private readonly categoriasService: CategoriasService) {}

  @Post()
  create(@Body() dto: CreateCategoriaDto) {
    return this.categoriasService.create(dto);
  }

  @Get()
  findAll() {
    return this.categoriasService.findAll();
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateCategoriaDto) {
    return this.categoriasService.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.categoriasService.remove(id);
  }
}
