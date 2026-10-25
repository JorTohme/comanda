import type { ThrottlerStorage } from "@nestjs/throttler";

/** Redis storage only when REDIS_URL is set; undefined selects the default in-memory storage (single instance only). */
export function selectThrottlerStorage(env: NodeJS.ProcessEnv, redis: ThrottlerStorage): ThrottlerStorage | undefined {
  return env.REDIS_URL?.trim() ? redis : undefined;
}
