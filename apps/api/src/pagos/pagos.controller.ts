import { Body, Controller, Inject, Logger, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { RolUsuario } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import { TenantContext } from "../auth/jwt.service";
import { Roles } from "../auth/roles.decorator";
import { CrearPreferenciaDto } from "./dto/crear-preferencia.dto";
import { PagosService } from "./pagos.service";
import { isValidWebhookSignature } from "./webhook-signature";

@Controller("pagos")
export class PagosController {
  private readonly logger = new Logger(PagosController.name);

  constructor(@Inject(PagosService) private readonly pagosService: PagosService) {}

  @Roles(RolUsuario.admin, RolUsuario.caja)
  @Post("preferencia")
  crearPreferencia(@Body() dto: CrearPreferenciaDto, @CurrentUser() user: TenantContext) {
    return this.pagosService.crearPreferencia(dto.pedidoId, user);
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

    try {
      await this.pagosService.procesarWebhook(dataId);
    } catch (err) {
      // Never let an internal reconciliation failure bubble up as a non-200: MP would retry
      // forever, and idempotency on the next attempt handles transient failures either way.
      this.logger.error(`Failed to process Mercado Pago webhook for payment ${dataId}`, err as Error);
    }
    return { status: "ok" };
  }
}
