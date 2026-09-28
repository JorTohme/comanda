import { Body, Controller, Get, Inject, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { RolUsuario } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentActor } from "../auth/current-actor.decorator";
import { Public } from "../auth/public.decorator";
import type { JwtClaims, TenantContext } from "../auth/jwt.service";
import { Roles } from "../auth/roles.decorator";
import { CrearPreferenciaDto } from "./dto/crear-preferencia.dto";
import { ReconciliarPagoDto } from "./dto/reconciliar-pago.dto";
import { PagosService } from "./pagos.service";
import { isValidWebhookSignature } from "./webhook-signature";

@Controller("pagos")
export class PagosController {
  constructor(@Inject(PagosService) private readonly pagosService: PagosService) {}

  @Roles(RolUsuario.admin, RolUsuario.caja)
  @Post("preferencia")
  crearPreferencia(
    @Body() dto: CrearPreferenciaDto,
    @CurrentUser() user: TenantContext,
    @CurrentActor() actor: JwtClaims,
  ) {
    return this.pagosService.crearPreferencia(dto.pedidoId, user, actor);
  }

  @Roles(RolUsuario.admin)
  @Get("incidentes")
  incidentes(@CurrentUser() user: TenantContext) {
    return this.pagosService.listarIncidentes(user);
  }

  @Roles(RolUsuario.admin)
  @Post(":id/reconciliar")
  reconciliar(
    @Param("id") id: string,
    @Body() dto: ReconciliarPagoDto,
    @CurrentUser() user: TenantContext,
    @CurrentActor() actor: JwtClaims,
  ) {
    return this.pagosService.reconciliar(id, dto.paymentId, user, actor);
  }

  @Public()
  @Post("webhook")
  async webhook(@Req() req: Request, @Query() query: Record<string, string>, @Body() body: Record<string, unknown>) {
    const dataId = query["data.id"] ?? (body?.data as { id?: string } | undefined)?.id;
    const type = query.type ?? (body?.type as string | undefined) ?? (body?.topic as string | undefined);

    if (!isValidWebhookSignature({
      xSignature: req.headers["x-signature"] as string | undefined,
      xRequestId: req.headers["x-request-id"] as string | undefined,
      dataId: dataId ?? "",
    })) {
      throw new UnauthorizedException("Invalid Mercado Pago webhook signature");
    }

    if (type !== "payment" || !dataId) return { status: "ignored" };

    await this.pagosService.procesarWebhook(dataId);
    return { status: "ok" };
  }
}
