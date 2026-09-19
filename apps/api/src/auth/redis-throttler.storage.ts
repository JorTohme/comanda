import { Injectable, OnModuleDestroy } from "@nestjs/common";
import type { ThrottlerStorage } from "@nestjs/throttler";
import type { ThrottlerStorageRecord } from "@nestjs/throttler/dist/throttler-storage-record.interface";
import { createClient, type RedisClientType } from "redis";

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly client: RedisClientType;
  private connecting?: Promise<void>;

  constructor() {
    this.client = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379" });
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number): Promise<ThrottlerStorageRecord> {
    await this.connect();
    const result = (await this.client.sendCommand([
      "EVAL",
      "local hits=redis.call('INCR',KEYS[1]); if hits==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; local blocked=redis.call('PTTL',KEYS[2]); if hits>tonumber(ARGV[2]) then local duration=tonumber(ARGV[3]); if duration<=0 then duration=tonumber(ARGV[1]) end; redis.call('SET',KEYS[2],'1','PX',duration); blocked=duration end; return {hits,redis.call('PTTL',KEYS[1]),blocked}",
      "2",
      key,
      `${key}:blocked`,
      `${ttl}`,
      `${limit}`,
      `${blockDuration}`,
    ])) as unknown as [number, number, number];
    return { totalHits: Number(result[0]), timeToExpire: Math.max(0, Number(result[1])), isBlocked: Number(result[2]) > 0, timeToBlockExpire: Math.max(0, Number(result[2])) };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }

  private async connect(): Promise<void> {
    if (this.client.isOpen) return;
    this.connecting ??= this.client.connect().then(() => undefined);
    await this.connecting;
  }
}
