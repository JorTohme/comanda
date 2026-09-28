import { ForbiddenException } from "@nestjs/common";
import type { EstadoPedido, RolUsuario } from "@prisma/client";

const allowed: Partial<Record<EstadoPedido, RolUsuario[]>> = {
  enviado_a_cocina: ["admin", "caja", "mozo"],
  en_preparacion: ["admin", "cocina"],
  listo: ["admin", "cocina"],
  en_camino: ["admin", "caja", "mozo"],
  entregado: ["admin", "caja", "mozo"],
  cobrado: ["admin", "caja"],
  cerrado: ["admin", "caja"],
};

export function assertPedidoCreateAllowed(rol: RolUsuario): void {
  if (!(["admin", "caja", "mozo"] as RolUsuario[]).includes(rol)) {
    throw new ForbiddenException("Action not allowed");
  }
}

export function assertPedidoActionAllowed(rol: RolUsuario, destino: EstadoPedido): void {
  if (!allowed[destino]?.includes(rol)) throw new ForbiddenException("Action not allowed");
}
