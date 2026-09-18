import { BadRequestException } from "@nestjs/common";
import type { EstadoPedido, TipoServicio } from "@prisma/client";
import { SIGUIENTE, assertTransicionValida } from "./estado-pedido";

const LINEAL: EstadoPedido[] = [
  "abierto",
  "enviado_a_cocina",
  "en_preparacion",
  "listo",
  "entregado",
  "cobrado",
  "cerrado",
];

function pedido(
  overrides: Partial<{ estado: EstadoPedido; tipoServicio: TipoServicio; direccionEnvio: string | null }>,
): { estado: EstadoPedido; tipoServicio: TipoServicio; direccionEnvio: string | null } {
  return {
    estado: "abierto",
    tipoServicio: "barra",
    direccionEnvio: null,
    ...overrides,
  };
}

describe("SIGUIENTE", () => {
  it("maps every non-terminal estado to its exact successor in the linear chain", () => {
    for (let i = 0; i < LINEAL.length - 1; i++) {
      expect(SIGUIENTE[LINEAL[i]]).toBe(LINEAL[i + 1]);
    }
  });

  it("maps the terminal estado cerrado to null", () => {
    expect(SIGUIENTE.cerrado).toBeNull();
  });

  it("maps en_camino to entregado", () => {
    expect(SIGUIENTE.en_camino).toBe("entregado");
  });
});

describe("assertTransicionValida", () => {
  it.each([
    ["abierto", "enviado_a_cocina"],
    ["enviado_a_cocina", "en_preparacion"],
    ["en_preparacion", "listo"],
    ["entregado", "cobrado"],
    ["cobrado", "cerrado"],
  ] as const)("accepts the legal transition %s -> %s for mesa/barra/takeaway/platform-delivery", (actual, destino) => {
    for (const tipoServicio of ["mesa", "barra", "takeaway", "delivery"] as const) {
      expect(() =>
        assertTransicionValida(pedido({ estado: actual, tipoServicio, direccionEnvio: null }), destino),
      ).not.toThrow();
    }
  });

  it("non-self-delivery (mesa/barra/takeaway/platform-delivery) goes listo -> entregado directly", () => {
    for (const tipoServicio of ["mesa", "barra", "takeaway", "delivery"] as const) {
      expect(() =>
        assertTransicionValida(pedido({ estado: "listo", tipoServicio, direccionEnvio: null }), "entregado"),
      ).not.toThrow();
    }
  });

  it("self-delivery (delivery + direccionEnvio) requires listo -> en_camino", () => {
    expect(() =>
      assertTransicionValida(pedido({ estado: "listo", tipoServicio: "delivery", direccionEnvio: "Calle 123" }), "en_camino"),
    ).not.toThrow();
  });

  it("self-delivery en_camino -> entregado is accepted", () => {
    expect(() =>
      assertTransicionValida(pedido({ estado: "en_camino", tipoServicio: "delivery", direccionEnvio: "Calle 123" }), "entregado"),
    ).not.toThrow();
  });

  it("rejects self-delivery skipping en_camino (listo -> entregado)", () => {
    expect(() =>
      assertTransicionValida(pedido({ estado: "listo", tipoServicio: "delivery", direccionEnvio: "Calle 123" }), "entregado"),
    ).toThrow(BadRequestException);
  });

  it("rejects non-self-delivery going to en_camino (listo -> en_camino)", () => {
    for (const tipoServicio of ["mesa", "barra", "takeaway", "delivery"] as const) {
      expect(() =>
        assertTransicionValida(pedido({ estado: "listo", tipoServicio, direccionEnvio: null }), "en_camino"),
      ).toThrow(BadRequestException);
    }
  });

  it("rejects a skip transition (abierto -> listo)", () => {
    expect(() => assertTransicionValida(pedido({ estado: "abierto" }), "listo")).toThrow(BadRequestException);
  });

  it("rejects a reverse transition (en_preparacion -> abierto)", () => {
    expect(() => assertTransicionValida(pedido({ estado: "en_preparacion" }), "abierto")).toThrow(BadRequestException);
  });

  it("rejects any transition out of the terminal cerrado state", () => {
    expect(() => assertTransicionValida(pedido({ estado: "cerrado" }), "abierto")).toThrow(BadRequestException);
  });

  it("rejects a no-op transition to the same estado", () => {
    expect(() => assertTransicionValida(pedido({ estado: "abierto" }), "abierto")).toThrow(BadRequestException);
  });
});
