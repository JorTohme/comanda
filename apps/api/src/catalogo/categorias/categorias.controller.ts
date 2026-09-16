import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { RolUsuario } from "@prisma/client";
import { CurrentUser } from "../../auth/current-user.decorator";
import { TenantContext } from "../../auth/jwt.service";
import { Roles } from "../../auth/roles.decorator";
import { CategoriasService } from "./categorias.service";
import { CreateCategoriaDto } from "./dto/create-categoria.dto";
import { UpdateCategoriaDto } from "./dto/update-categoria.dto";

@Controller("categorias")
export class CategoriasController {
  constructor(@Inject(CategoriasService) private readonly categoriasService: CategoriasService) {}

  @Roles(RolUsuario.admin)
  @Post()
  create(@Body() dto: CreateCategoriaDto, @CurrentUser() user: TenantContext) { return this.categoriasService.create(dto, user); }
  @Get()
  findAll(@CurrentUser() user: TenantContext) { return this.categoriasService.findAll(user); }
  @Roles(RolUsuario.admin)
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateCategoriaDto, @CurrentUser() user: TenantContext) { return this.categoriasService.update(id, dto, user); }
  @Roles(RolUsuario.admin)
  @Delete(":id")
  remove(@Param("id") id: string, @CurrentUser() user: TenantContext) { return this.categoriasService.remove(id, user); }
}
