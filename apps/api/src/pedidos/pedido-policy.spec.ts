import { ForbiddenException } from "@nestjs/common";
import { EstadoPedido, RolUsuario } from "@prisma/client";
import { assertPedidoActionAllowed } from "./pedido-policy";

const roles = Object.values(RolUsuario);
const allowed: Record<EstadoPedido, RolUsuario[]> = {
  abierto: [],
  enviado_a_cocina: ["admin", "caja", "mozo"],
  en_preparacion: ["admin", "cocina"],
  listo: ["admin", "cocina"],
  en_camino: ["admin", "caja", "mozo"],
  entregado: ["admin", "caja", "mozo"],
  cobrado: ["admin", "caja"],
  cerrado: ["admin", "caja"],
};

describe("pedido action policy", () => {
  it.each(Object.values(EstadoPedido).flatMap((destino) => roles.map((rol) => [rol, destino] as const)))(
    "enforces %s -> %s",
    (rol, destino) => {
      if (allowed[destino].includes(rol)) {
        expect(() => assertPedidoActionAllowed(rol, destino)).not.toThrow();
      } else {
        expect(() => assertPedidoActionAllowed(rol, destino)).toThrow(ForbiddenException);
      }
    },
  );
});
