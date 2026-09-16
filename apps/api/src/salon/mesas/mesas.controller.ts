import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../../auth/current-user.decorator";
import { TenantContext } from "../../auth/jwt.service";
import { MesasService } from "./mesas.service";
import { CreateMesaDto } from "./dto/create-mesa.dto";
import { UpdateMesaDto } from "./dto/update-mesa.dto";

@Controller("mesas")
export class MesasController {
  constructor(@Inject(MesasService) private readonly mesasService: MesasService) {}
  @Post() create(@Body() dto: CreateMesaDto, @CurrentUser() user: TenantContext) { return this.mesasService.create(dto, user); }
  @Get() findAll(@CurrentUser() user: TenantContext) { return this.mesasService.findAll(user); }
  @Patch(":id") update(@Param("id") id: string, @Body() dto: UpdateMesaDto, @CurrentUser() user: TenantContext) { return this.mesasService.update(id, dto, user); }
  @Delete(":id") remove(@Param("id") id: string, @CurrentUser() user: TenantContext) { return this.mesasService.remove(id, user); }
}
