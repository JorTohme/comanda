import { BadRequestException } from "@nestjs/common";
import { canonicalPedido } from "./pedidos.service";

describe("canonicalPedido", () => {
  it("normalizes destination whitespace and combines duplicate dish lines deterministically", () => {
    const normalized = canonicalPedido({
      tipoServicio: "delivery",
      plataforma: "  App  ",
      items: [
        { platoId: "dish-b", cantidad: 1 },
        { platoId: "dish-a", cantidad: 1 },
        { platoId: "dish-b", cantidad: 2 },
      ],
    });

    expect(normalized).toBe(JSON.stringify({
      tipoServicio: "delivery",
      mesaId: null,
      plataforma: "App",
      direccionEnvio: null,
      items: [{ platoId: "dish-a", cantidad: 1 }, { platoId: "dish-b", cantidad: 3 }],
    }));
  });

  it.each([
    { tipoServicio: "barra" as const, items: [] },
    { tipoServicio: "barra" as const, items: [{ platoId: "dish", cantidad: 0 }] },
    { tipoServicio: "delivery" as const, plataforma: "  ", direccionEnvio: "\t", items: [{ platoId: "dish", cantidad: 1 }] },
    { tipoServicio: "mesa" as const, items: [{ platoId: "dish", cantidad: 1 }] },
  ])("rejects invalid order shape %#", (input) => {
    expect(() => canonicalPedido(input)).toThrow(BadRequestException);
  });

  it("rejects combined duplicate dish quantity over the supported limit", () => {
    expect(() => canonicalPedido({
      tipoServicio: "barra",
      items: [
        { platoId: "dish", cantidad: 999 },
        { platoId: "dish", cantidad: 1 },
      ],
    })).toThrow(BadRequestException);
  });
});
