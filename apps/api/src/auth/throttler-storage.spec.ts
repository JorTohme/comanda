import { selectThrottlerStorage } from "./throttler-storage";

describe("selectThrottlerStorage", () => {
  const redisStorage = { increment: jest.fn() };

  it("uses Redis storage when REDIS_URL is set", () => {
    expect(selectThrottlerStorage({ REDIS_URL: "redis://localhost:6379" }, redisStorage)).toBe(redisStorage);
  });

  it.each([{}, { REDIS_URL: "" }, { REDIS_URL: "   " }])("falls back to in-memory storage for %j", (env) => {
    expect(selectThrottlerStorage(env, redisStorage)).toBeUndefined();
  });
});
