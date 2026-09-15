import { Body, Controller, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { PedidosService } from "./pedidos.service";
import { CreatePedidoDto } from "./dto/create-pedido.dto";
import { UpdateEstadoPedidoDto } from "./dto/update-estado-pedido.dto";

@Controller("pedidos")
export class PedidosController {
  // ponytail: explicit @Inject token — see categorias.controller.ts for why.
  constructor(@Inject(PedidosService) private readonly pedidosService: PedidosService) {}

  @Post()
  create(@Body() dto: CreatePedidoDto) {
    return this.pedidosService.create(dto);
  }

  @Get()
  findAll() {
    return this.pedidosService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.pedidosService.findOne(id);
  }

  @Patch(":id/estado")
  updateEstado(@Param("id") id: string, @Body() dto: UpdateEstadoPedidoDto) {
    return this.pedidosService.updateEstado(id, dto.estado);
  }
}
