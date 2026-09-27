export interface RuntimeConfig {
  corsOrigins: string[];
  swaggerEnabled: boolean;
}

export function resolveRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const production = env.NODE_ENV === "production";
  const required = production
    ? ["JWT_SECRET", "CORS_ORIGINS", "MERCADOPAGO_ACCESS_TOKEN", "MERCADOPAGO_WEBHOOK_SECRET", "PUBLIC_BASE_URL", "WEB_APP_URL"]
    : [];
  for (const name of required) {
    if (!env[name]?.trim()) throw new Error(`${name} environment variable must be set in production`);
  }
  const corsOrigins = (env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:5173")
    .split(",").map((origin) => origin.trim()).filter(Boolean);
  if (production && corsOrigins.length === 0) throw new Error("CORS_ORIGINS environment variable must be set in production");
  return { corsOrigins, swaggerEnabled: !production };
}
