import { Body, Controller, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { RolUsuario } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentActor } from "../auth/current-actor.decorator";
import { JwtClaims } from "../auth/jwt.service";
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
  abrirTurno(@Body() dto: AbrirTurnoDto, @CurrentUser() user: TenantContext, @CurrentActor() actor: JwtClaims) {
    return this.cajaService.abrirTurno(dto, user, actor);
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
    @CurrentActor() actor: JwtClaims,
  ) {
    return this.cajaService.registrarMovimiento(id, dto, user, actor);
  }

  @Patch(":id/cerrar")
  cerrarTurno(
    @Param("id") id: string,
    @Body() dto: CerrarTurnoDto,
    @CurrentUser() user: TenantContext,
    @CurrentActor() actor: JwtClaims,
  ) {
    return this.cajaService.cerrarTurno(id, dto, user, actor);
  }
}
