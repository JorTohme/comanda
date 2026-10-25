import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Server as IoServer } from "socket.io";
import { createClient } from "redis";
import { RedisIoAdapter } from "./redis-io.adapter";

jest.mock("redis", () => ({ createClient: jest.fn() }));

describe("RedisIoAdapter", () => {
  const originalRedisUrl = process.env.REDIS_URL;
  afterEach(() => {
    jest.mocked(createClient).mockReset();
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
  });

  it("closes both connected Redis clients when the application shuts down", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const subscriber = { isOpen: true, connect: jest.fn(), quit: jest.fn().mockResolvedValue(undefined) };
    const publisher = {
      isOpen: true,
      connect: jest.fn(),
      quit: jest.fn().mockResolvedValue(undefined),
      duplicate: jest.fn().mockReturnValue(subscriber),
    };
    jest.mocked(createClient).mockReturnValue(publisher as never);

    const adapter = new RedisIoAdapter({ getHttpServer: () => undefined } as never, []);
    await expect(adapter.connectToRedis()).resolves.toBe(true);
    await adapter.close();

    expect(publisher.quit).toHaveBeenCalledTimes(1);
    expect(subscriber.quit).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "", "  "])("does not connect to Redis when REDIS_URL is %p", async (value) => {
    if (value === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = value;

    const adapter = new RedisIoAdapter({ getHttpServer: () => undefined } as never, []);

    await expect(adapter.connectToRedis()).resolves.toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  describe("WebSocket CORS", () => {
    let http: Server;
    let io: IoServer;
    let url: string;

    beforeEach(async () => {
      http = createServer();
      io = new RedisIoAdapter(http, ["https://app.example.com"]).createIOServer(0, { cors: { origin: "*" } } as never);
      await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
      url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/socket.io/?EIO=4&transport=polling`;
    });

    afterEach(async () => {
      http.closeAllConnections();
      await io.close();
    });

    it("allows a configured origin", async () => {
      const response = await fetch(url, { headers: { Origin: "https://app.example.com" } });
      expect(response.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    });

    it("does not allow an origin outside the configured list, even if the gateway asked for *", async () => {
      const response = await fetch(url, { headers: { Origin: "https://evil.example.com" } });
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    });
  });
});
