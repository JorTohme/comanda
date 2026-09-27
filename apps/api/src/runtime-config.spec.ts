import { resolveRuntimeConfig } from "./runtime-config";

describe("resolveRuntimeConfig", () => {
  it("rejects incomplete production security configuration", () => {
    expect(() => resolveRuntimeConfig({ NODE_ENV: "production", JWT_SECRET: "secret" })).toThrow("CORS_ORIGINS");
  });

  it("rejects incomplete production Mercado Pago configuration", () => {
    expect(() => resolveRuntimeConfig({
      NODE_ENV: "production", JWT_SECRET: "secret", CORS_ORIGINS: "https://admin.example.com",
    })).toThrow("MERCADOPAGO_ACCESS_TOKEN");
  });

  it("uses explicit production CORS origins and disables Swagger", () => {
    expect(resolveRuntimeConfig({
      NODE_ENV: "production", JWT_SECRET: "secret", CORS_ORIGINS: "https://admin.example.com,https://ops.example.com",
      MERCADOPAGO_ACCESS_TOKEN: "token", MERCADOPAGO_WEBHOOK_SECRET: "webhook", PUBLIC_BASE_URL: "https://api.example.com", WEB_APP_URL: "https://admin.example.com",
    })).toEqual({ corsOrigins: ["https://admin.example.com", "https://ops.example.com"], swaggerEnabled: false });
  });
});
