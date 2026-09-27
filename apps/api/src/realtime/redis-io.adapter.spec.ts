import { createClient } from "redis";
import { RedisIoAdapter } from "./redis-io.adapter";

jest.mock("redis", () => ({ createClient: jest.fn() }));

describe("RedisIoAdapter", () => {
  it("closes both connected Redis clients when the application shuts down", async () => {
    const subscriber = { isOpen: true, connect: jest.fn(), quit: jest.fn().mockResolvedValue(undefined) };
    const publisher = {
      isOpen: true,
      connect: jest.fn(),
      quit: jest.fn().mockResolvedValue(undefined),
      duplicate: jest.fn().mockReturnValue(subscriber),
    };
    jest.mocked(createClient).mockReturnValue(publisher as never);

    const adapter = new RedisIoAdapter({ getHttpServer: () => undefined } as never);
    await adapter.connectToRedis();
    await adapter.close();

    expect(publisher.quit).toHaveBeenCalledTimes(1);
    expect(subscriber.quit).toHaveBeenCalledTimes(1);
  });
});
