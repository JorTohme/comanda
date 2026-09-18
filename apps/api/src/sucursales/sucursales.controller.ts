import { Body, Controller, Get, Inject, Post } from "@nestjs/common";
import { RolUsuario } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import { TenantContext } from "../auth/jwt.service";
import { Roles } from "../auth/roles.decorator";
import { CreateSucursalDto } from "./dto/create-sucursal.dto";
import { SucursalesService } from "./sucursales.service";

// Scoped by orgId only, not orgId+sucursalId: this module manages the branches
// themselves, so an admin must see every branch in the org, not just their own.
// Do not "fix" this by adding a sucursalId filter.
@Controller("sucursales")
export class SucursalesController {
  constructor(@Inject(SucursalesService) private readonly sucursalesService: SucursalesService) {}

  @Roles(RolUsuario.admin)
  @Post()
  create(@Body() dto: CreateSucursalDto, @CurrentUser() user: TenantContext) {
    return this.sucursalesService.create(dto, user.orgId);
  }

  @Roles(RolUsuario.admin)
  @Get()
  findAll(@CurrentUser() user: TenantContext) {
    return this.sucursalesService.findAll(user.orgId);
  }
}
