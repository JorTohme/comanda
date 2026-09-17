import { categoriaSchema, centavosToPesos, pesosToCentavos, posicionPorDefecto } from "./index";

describe("centavosToPesos", () => {
  it("formats whole pesos with two decimals", () => {
    expect(centavosToPesos(1550)).toBe("15.50");
  });

  it("formats zero", () => {
    expect(centavosToPesos(0)).toBe("0.00");
  });

  it("pads single-digit centavos", () => {
    expect(centavosToPesos(105)).toBe("1.05");
  });
});

describe("pesosToCentavos", () => {
  it("parses a two-decimal string", () => {
    expect(pesosToCentavos("15.50")).toBe(1550);
  });

  it("parses zero", () => {
    expect(pesosToCentavos("0.00")).toBe(0);
  });

  it("parses a one-decimal string as if trailing-zero padded", () => {
    expect(pesosToCentavos("15.5")).toBe(1550);
  });

  it("parses a whole-number string with no decimal point", () => {
    expect(pesosToCentavos("20")).toBe(2000);
  });
});

describe("round-trip", () => {
  it("survives centavos -> pesos -> centavos without float drift", () => {
    for (const centavos of [0, 1, 5, 99, 100, 1550, 999999]) {
      expect(pesosToCentavos(centavosToPesos(centavos))).toBe(centavos);
    }
  });
});

describe("posicionPorDefecto", () => {
  it("stays within 0-100 on both axes for the first 20 indices", () => {
    for (let i = 0; i < 20; i++) {
      const { x, y } = posicionPorDefecto(i);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(0);
    }
  });

  it("gives different positions for consecutive indices", () => {
    expect(posicionPorDefecto(0)).not.toEqual(posicionPorDefecto(1));
  });

  it("is deterministic for the same index", () => {
    expect(posicionPorDefecto(3)).toEqual(posicionPorDefecto(3));
  });
});

describe("runtime contracts", () => {
  it("rejects a category response that is not tenant-scoped", () => {
    expect(() =>
      categoriaSchema.parse({
        id: "00000000-0000-0000-0000-000000000001",
        nombre: "Bebidas",
        createdAt: "2026-09-15T00:00:00.000Z",
        updatedAt: "2026-09-15T00:00:00.000Z",
      }),
    ).toThrow();
  });
});
