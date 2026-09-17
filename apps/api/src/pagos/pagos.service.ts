import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { TenantContext } from "../auth/jwt.service";
import { PrismaService } from "../prisma/prisma.service";
import { PedidosService } from "../pedidos/pedidos.service";
import { MercadoPagoClient } from "./mercadopago.client";

@Injectable()
export class PagosService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MercadoPagoClient) private readonly mpClient: MercadoPagoClient,
    @Inject(PedidosService) private readonly pedidosService: PedidosService,
  ) {}

  async crearPreferencia(pedidoId: string, tenant: TenantContext): Promise<{ initPoint: string; preferenceId: string }> {
    const pedido = await this.prisma.pedido.findFirst({ where: { id: pedidoId, ...tenant }, include: { items: true } });
    if (!pedido) throw new NotFoundException(`Pedido ${pedidoId} not found`);

    const existente = await this.prisma.pago.findUnique({ where: { pedidoId } });
    if (existente) {
      if (existente.estado === "pendiente") {
        return { initPoint: existente.mpInitPoint, preferenceId: existente.mpPreferenceId };
      }
      throw new BadRequestException(`Pedido ${pedidoId} already has a processed payment`);
    }

    const notificationUrl = `${process.env.PUBLIC_BASE_URL ?? ""}/pagos/webhook`;
    const monto = pedido.items.reduce((acc, item) => acc + item.precioUnitario * item.cantidad, 0);

    const creada = await this.mpClient.crearPreferencia({
      pedidoId,
      items: pedido.items.map((item) => ({
        id: item.platoId,
        title: item.nombre,
        quantity: item.cantidad,
        unitPrice: item.precioUnitario / 100,
      })),
      notificationUrl,
    });

    await this.prisma.pago.create({
      data: {
        pedidoId,
        mpPreferenceId: creada.preferenceId,
        mpInitPoint: creada.initPoint,
        estado: "pendiente",
        monto,
        ...tenant,
      },
    });

    return { initPoint: creada.initPoint, preferenceId: creada.preferenceId };
  }

  async procesarWebhook(paymentId: string): Promise<void> {
    const pago = await this.mpClient.obtenerPago(paymentId);
    if (!pago.externalReference) return;

    const registro = await this.prisma.pago.findUnique({ where: { pedidoId: pago.externalReference } });
    if (!registro) return;

    // Dedupe against MP's retried/duplicate webhook deliveries for the same payment.
    if (registro.mpPaymentId === paymentId && registro.estado !== "pendiente") return;

    if (pago.status === "approved") {
      await this.prisma.pago.update({ where: { id: registro.id }, data: { estado: "aprobado", mpPaymentId: paymentId } });
      const tenant: TenantContext = { orgId: registro.orgId, sucursalId: registro.sucursalId };
      try {
        await this.pedidosService.updateEstado(registro.pedidoId, "cobrado", tenant);
      } catch (err) {
        // Known limitation: the payment arrived before the pedido was marked entregado, so the
        // entregado -> cobrado transition guard rejects it. The payment truth (Pago.estado = aprobado)
        // is still persisted above; only the Pedido state transition is skipped.
        if (err instanceof BadRequestException) return;
        throw err;
      }
      return;
    }

    if (pago.status === "rejected") {
      await this.prisma.pago.update({ where: { id: registro.id }, data: { estado: "rechazado", mpPaymentId: paymentId } });
      return;
    }

    // pending / in_process / other non-terminal statuses: no-op, MP will notify again later.
  }
}
