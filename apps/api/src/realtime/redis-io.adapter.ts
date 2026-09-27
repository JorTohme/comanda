import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import type { ServerOptions } from "socket.io";

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: ReturnType<typeof createClient>;
  private subClient?: ReturnType<typeof createClient>;

  async connectToRedis(): Promise<void> {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    this.pubClient = createClient({ url });
    this.subClient = this.pubClient.duplicate();
    await Promise.all([this.pubClient.connect(), this.subClient.connect()]);
    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  async close(server?: Parameters<IoAdapter["close"]>[0]): Promise<void> {
    if (server) await super.close(server);
    await Promise.all([this.pubClient, this.subClient].map(async (client) => {
      if (client?.isOpen) await client.quit();
    }));
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
