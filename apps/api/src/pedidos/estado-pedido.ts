import { BadRequestException } from "@nestjs/common";
import type { EstadoPedido } from "@prisma/client";

export const SIGUIENTE: Record<EstadoPedido, EstadoPedido | null> = {
  abierto: "enviado_a_cocina",
  enviado_a_cocina: "en_preparacion",
  en_preparacion: "listo",
  listo: "entregado",
  entregado: "cobrado",
  cobrado: "cerrado",
  cerrado: null,
};

export function assertTransicionValida(actual: EstadoPedido, destino: EstadoPedido) {
  if (SIGUIENTE[actual] !== destino) {
    throw new BadRequestException(`Cannot transition Pedido from ${actual} to ${destino}`);
  }
}
