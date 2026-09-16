import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../auth/current-user.decorator";
import { TenantContext } from "../../auth/jwt.service";
import { PlatosService } from "./platos.service";
import { CreatePlatoDto } from "./dto/create-plato.dto";
import { UpdatePlatoDto } from "./dto/update-plato.dto";

@Controller("platos")
export class PlatosController {
  constructor(@Inject(PlatosService) private readonly platosService: PlatosService) {}
  @Post() create(@Body() dto: CreatePlatoDto, @CurrentUser() user: TenantContext) { return this.platosService.create(dto, user); }
  @Get() findAll(@Query("categoriaId") categoriaId: string | undefined, @CurrentUser() user: TenantContext) { return this.platosService.findAll(categoriaId, user); }
  @Patch(":id") update(@Param("id") id: string, @Body() dto: UpdatePlatoDto, @CurrentUser() user: TenantContext) { return this.platosService.update(id, dto, user); }
  @Delete(":id") remove(@Param("id") id: string, @CurrentUser() user: TenantContext) { return this.platosService.remove(id, user); }
}
