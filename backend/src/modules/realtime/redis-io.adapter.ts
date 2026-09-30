import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { ServerOptions } from 'socket.io';
import { RedisService } from '../../common/redis/redis.service';

/** Socket.IO adapter backed by Redis pub/sub so events reach clients connected to any API replica. */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  constructor(private readonly appCtx: INestApplicationContext) {
    super(appCtx);
  }

  connectToRedis(): void {
    const redis = this.appCtx.get(RedisService);
    this.adapterConstructor = createAdapter(redis.create('io-pub'), redis.create('io-sub'));
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, { ...options, transports: ['websocket', 'polling'] });
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
