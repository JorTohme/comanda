import { BadRequestException } from "@nestjs/common";
import type { EstadoPedido } from "@prisma/client";
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

describe("SIGUIENTE", () => {
  it("maps every non-terminal estado to its exact successor in the linear chain", () => {
    for (let i = 0; i < LINEAL.length - 1; i++) {
      expect(SIGUIENTE[LINEAL[i]]).toBe(LINEAL[i + 1]);
    }
  });

  it("maps the terminal estado cerrado to null", () => {
    expect(SIGUIENTE.cerrado).toBeNull();
  });
});

describe("assertTransicionValida", () => {
  it.each([
    ["abierto", "enviado_a_cocina"],
    ["enviado_a_cocina", "en_preparacion"],
    ["en_preparacion", "listo"],
    ["listo", "entregado"],
    ["entregado", "cobrado"],
    ["cobrado", "cerrado"],
  ] as const)("accepts the legal transition %s -> %s", (actual, destino) => {
    expect(() => assertTransicionValida(actual, destino)).not.toThrow();
  });

  it("rejects a skip transition (abierto -> listo)", () => {
    expect(() => assertTransicionValida("abierto", "listo")).toThrow(BadRequestException);
  });

  it("rejects a reverse transition (en_preparacion -> abierto)", () => {
    expect(() => assertTransicionValida("en_preparacion", "abierto")).toThrow(BadRequestException);
  });

  it("rejects any transition out of the terminal cerrado state", () => {
    expect(() => assertTransicionValida("cerrado", "abierto")).toThrow(BadRequestException);
  });

  it("rejects a no-op transition to the same estado", () => {
    expect(() => assertTransicionValida("abierto", "abierto")).toThrow(BadRequestException);
  });
});
