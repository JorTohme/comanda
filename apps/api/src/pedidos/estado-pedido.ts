import { BadRequestException } from "@nestjs/common";
import type { EstadoPedido, Pedido } from "@prisma/client";

export const SIGUIENTE: Record<EstadoPedido, EstadoPedido | null> = {
  abierto: "enviado_a_cocina",
  enviado_a_cocina: "en_preparacion",
  en_preparacion: "listo",
  listo: "entregado",
  en_camino: "entregado",
  entregado: "cobrado",
  cobrado: "cerrado",
  cerrado: null,
};

function esAutoDelivery(pedido: Pick<Pedido, "tipoServicio" | "direccionEnvio">): boolean {
  return pedido.tipoServicio === "delivery" && pedido.direccionEnvio != null;
}

export function assertTransicionValida(
  pedido: Pick<Pedido, "estado" | "tipoServicio" | "direccionEnvio">,
  destino: EstadoPedido,
) {
  const esperado = pedido.estado === "listo" && esAutoDelivery(pedido) ? "en_camino" : SIGUIENTE[pedido.estado];
  if (esperado !== destino) {
    throw new BadRequestException(`Cannot transition Pedido from ${pedido.estado} to ${destino}`);
  }
}
