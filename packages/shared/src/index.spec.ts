import { centavosToPesos, pesosToCentavos } from "./index";

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
