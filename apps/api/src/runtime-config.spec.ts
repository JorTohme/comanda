import { resolveRuntimeConfig } from "./runtime-config";

const base = { NODE_ENV: "production", JWT_SECRET: "secret", CORS_ORIGINS: "https://admin.example.com", WEB_APP_URL: "https://admin.example.com" };
const mp = { MERCADOPAGO_ACCESS_TOKEN: "token", MERCADOPAGO_WEBHOOK_SECRET: "webhook", MERCADOPAGO_MERCHANT_ID: "777", PUBLIC_BASE_URL: "https://api.example.com" };

describe("resolveRuntimeConfig", () => {
  it("rejects incomplete production security configuration", () => {
    expect(() => resolveRuntimeConfig({ NODE_ENV: "production", JWT_SECRET: "secret" })).toThrow("CORS_ORIGINS");
  });

  it("rejects production Mercado Pago configuration missing a companion variable", () => {
    for (const name of ["MERCADOPAGO_WEBHOOK_SECRET", "MERCADOPAGO_MERCHANT_ID", "PUBLIC_BASE_URL"] as const) {
      expect(() => resolveRuntimeConfig({ ...base, ...mp, [name]: " " })).toThrow(name);
    }
  });

  it("rejects partial Mercado Pago configuration without an access token", () => {
    expect(() => resolveRuntimeConfig({ ...base, MERCADOPAGO_MERCHANT_ID: "777" })).toThrow("MERCADOPAGO_ACCESS_TOKEN");
  });

  it("allows production without Mercado Pago and reports it disabled", () => {
    expect(resolveRuntimeConfig({ ...base, MERCADOPAGO_ACCESS_TOKEN: " " })).toEqual({
      corsOrigins: ["https://admin.example.com"], swaggerEnabled: false, mercadoPagoEnabled: false,
    });
  });

  it("uses explicit production CORS origins and disables Swagger", () => {
    expect(resolveRuntimeConfig({
      ...base, ...mp, CORS_ORIGINS: "https://admin.example.com,https://ops.example.com",
    })).toEqual({ corsOrigins: ["https://admin.example.com", "https://ops.example.com"], swaggerEnabled: false, mercadoPagoEnabled: true });
  });
});
