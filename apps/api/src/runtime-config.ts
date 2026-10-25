export interface RuntimeConfig {
  corsOrigins: string[];
  swaggerEnabled: boolean;
  mercadoPagoEnabled: boolean;
}

export function isMercadoPagoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.MERCADOPAGO_ACCESS_TOKEN?.trim());
}

export function resolveRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const production = env.NODE_ENV === "production";
  const mercadoPagoEnabled = isMercadoPagoEnabled(env);
  const mercadoPagoCompanions = ["MERCADOPAGO_WEBHOOK_SECRET", "MERCADOPAGO_MERCHANT_ID", "PUBLIC_BASE_URL"];
  const required = production
    ? ["JWT_SECRET", "CORS_ORIGINS", "WEB_APP_URL", ...(mercadoPagoEnabled ? mercadoPagoCompanions : [])]
    : [];
  for (const name of required) {
    if (!env[name]?.trim()) throw new Error(`${name} environment variable must be set in production`);
  }
  if (production && !mercadoPagoEnabled) {
    const partial = mercadoPagoCompanions.find((name) => env[name]?.trim());
    if (partial) throw new Error(`MERCADOPAGO_ACCESS_TOKEN environment variable must be set in production when ${partial} is set`);
  }
  const corsOrigins = (env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:5173")
    .split(",").map((origin) => origin.trim()).filter(Boolean);
  if (production && corsOrigins.length === 0) throw new Error("CORS_ORIGINS environment variable must be set in production");
  return { corsOrigins, swaggerEnabled: !production, mercadoPagoEnabled };
}
