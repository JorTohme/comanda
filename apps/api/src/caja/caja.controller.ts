import { Body, Controller, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { RolUsuario } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserId } from "../auth/current-user-id.decorator";
import { TenantContext } from "../auth/jwt.service";
import { Roles } from "../auth/roles.decorator";
import { CajaService } from "./caja.service";
import { AbrirTurnoDto } from "./dto/abrir-turno.dto";
import { CerrarTurnoDto } from "./dto/cerrar-turno.dto";
import { CreateMovimientoDto } from "./dto/create-movimiento.dto";

@Roles(RolUsuario.admin, RolUsuario.caja)
@Controller("caja/turnos")
export class CajaController {
  constructor(@Inject(CajaService) private readonly cajaService: CajaService) {}

  @Post()
  abrirTurno(@Body() dto: AbrirTurnoDto, @CurrentUserId() usuarioId: string, @CurrentUser() user: TenantContext) {
    return this.cajaService.abrirTurno(dto, usuarioId, user);
  }

  @Get("actual")
  obtenerActual(@CurrentUser() user: TenantContext) {
    return this.cajaService.obtenerActual(user);
  }

  @Get()
  listar(@CurrentUser() user: TenantContext) {
    return this.cajaService.listar(user);
  }

  @Get(":id")
  obtenerUno(@Param("id") id: string, @CurrentUser() user: TenantContext) {
    return this.cajaService.obtenerUno(id, user);
  }

  @Post(":id/movimientos")
  registrarMovimiento(
    @Param("id") id: string,
    @Body() dto: CreateMovimientoDto,
    @CurrentUser() user: TenantContext,
  ) {
    return this.cajaService.registrarMovimiento(id, dto, user);
  }

  @Patch(":id/cerrar")
  cerrarTurno(
    @Param("id") id: string,
    @Body() dto: CerrarTurnoDto,
    @CurrentUserId() usuarioId: string,
    @CurrentUser() user: TenantContext,
  ) {
    return this.cajaService.cerrarTurno(id, dto, usuarioId, user);
  }
}
