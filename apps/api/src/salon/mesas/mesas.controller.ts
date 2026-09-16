import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { RolUsuario } from "@prisma/client";
import { CurrentUser } from "../../auth/current-user.decorator";
import { TenantContext } from "../../auth/jwt.service";
import { Roles } from "../../auth/roles.decorator";
import { MesasService } from "./mesas.service";
import { CreateMesaDto } from "./dto/create-mesa.dto";
import { UpdateMesaDto } from "./dto/update-mesa.dto";

@Controller("mesas")
export class MesasController {
  constructor(@Inject(MesasService) private readonly mesasService: MesasService) {}
  @Roles(RolUsuario.admin, RolUsuario.mozo) @Post() create(@Body() dto: CreateMesaDto, @CurrentUser() user: TenantContext) { return this.mesasService.create(dto, user); }
  @Get() findAll(@CurrentUser() user: TenantContext) { return this.mesasService.findAll(user); }
  @Roles(RolUsuario.admin, RolUsuario.mozo) @Patch(":id") update(@Param("id") id: string, @Body() dto: UpdateMesaDto, @CurrentUser() user: TenantContext) { return this.mesasService.update(id, dto, user); }
  @Roles(RolUsuario.admin, RolUsuario.mozo) @Delete(":id") remove(@Param("id") id: string, @CurrentUser() user: TenantContext) { return this.mesasService.remove(id, user); }
}
