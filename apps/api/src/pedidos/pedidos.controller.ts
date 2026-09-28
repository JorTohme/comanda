import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { RolUsuario } from "@prisma/client";
import { CurrentActor } from "../auth/current-actor.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtClaims, TenantContext } from "../auth/jwt.service";
import { Roles } from "../auth/roles.decorator";
import { CreatePedidoDto } from "./dto/create-pedido.dto";
import { UpdateEstadoPedidoDto } from "./dto/update-estado-pedido.dto";
import { PedidosService } from "./pedidos.service";
import { CobrosService } from "./cobros.service";

@Controller("pedidos")
export class PedidosController {
  constructor(@Inject(PedidosService) private readonly pedidosService: PedidosService, @Inject(CobrosService) private readonly cobrosService: CobrosService) {}
  // caja: permite tomar un pedido desde la PC (mostrador/teléfono) sin depender de la app del mozo.
  @Roles(RolUsuario.admin, RolUsuario.mozo, RolUsuario.caja) @Post() create(@Body() dto: CreatePedidoDto, @CurrentUser() user: TenantContext, @CurrentActor() actor: JwtClaims) { return this.pedidosService.create(dto, user, actor); }
  @Get() findAll(@CurrentUser() user: TenantContext) { return this.pedidosService.findAll(user); }
  @Get(":id") findOne(@Param("id") id: string, @CurrentUser() user: TenantContext) { return this.pedidosService.findOne(id, user); }
  @Roles(RolUsuario.admin, RolUsuario.mozo, RolUsuario.caja, RolUsuario.cocina) @Patch(":id/estado") updateEstado(@Param("id") id: string, @Body() dto: UpdateEstadoPedidoDto, @CurrentUser() user: TenantContext, @CurrentActor() actor: JwtClaims) {
    if (dto.estado === "cobrado") throw new BadRequestException("Use the explicit cash collection endpoint");
    return this.pedidosService.updateEstado(id, dto, user, actor);
  }
  @Roles(RolUsuario.admin, RolUsuario.caja) @Post(":id/cobro-efectivo") cobrarEfectivo(@Param("id") id: string, @CurrentUser() user: TenantContext, @CurrentActor() actor: JwtClaims) {
    return this.cobrosService.cobrarEfectivo(id, user, actor);
  }
}
