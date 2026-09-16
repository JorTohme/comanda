import { Body, Controller, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { TenantContext } from "../auth/jwt.service";
import { CreatePedidoDto } from "./dto/create-pedido.dto";
import { UpdateEstadoPedidoDto } from "./dto/update-estado-pedido.dto";
import { PedidosService } from "./pedidos.service";

@Controller("pedidos")
export class PedidosController {
  constructor(@Inject(PedidosService) private readonly pedidosService: PedidosService) {}
  @Post() create(@Body() dto: CreatePedidoDto, @CurrentUser() user: TenantContext) { return this.pedidosService.create(dto, user); }
  @Get() findAll(@CurrentUser() user: TenantContext) { return this.pedidosService.findAll(user); }
  @Get(":id") findOne(@Param("id") id: string, @CurrentUser() user: TenantContext) { return this.pedidosService.findOne(id, user); }
  @Patch(":id/estado") updateEstado(@Param("id") id: string, @Body() dto: UpdateEstadoPedidoDto, @CurrentUser() user: TenantContext) { return this.pedidosService.updateEstado(id, dto.estado, user); }
}
