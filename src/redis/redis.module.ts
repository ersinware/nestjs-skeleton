import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './constant/redis.constant';

@Global()
@Module({
    providers: [
        {
            provide: REDIS_CLIENT,
            useFactory: (config: ConfigService) => {
                const redis = new Redis({
                    host: config.getOrThrow<string>('REDIS_HOST'),
                    port: config.getOrThrow<number>('REDIS_PORT'),
                    password: config.getOrThrow<string>('REDIS_PASSWORD'),
                    maxRetriesPerRequest: config.getOrThrow<number>('REDIS_MAX_RETRIES_PER_REQUEST'),
                    commandTimeout: config.getOrThrow<number>('REDIS_COMMAND_TIMEOUT'),
                });

                redis.on('error', (error: Error) => {
                    console.error(`Redis connection failed: ${error.message}`);
                });

                return redis;
            },
            inject: [ConfigService],
        },
    ],
    exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

    async onApplicationShutdown() {
        await this.redis.quit();
    }
}
