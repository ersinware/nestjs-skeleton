/**
 * @file rate-limit-health.adapter.ts
 * @description Probes rate-limit Redis through its existing connection with a bounded PING.
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TimeoutError, type RedisClientType } from 'redis';
import { ENV } from 'src/core/config';
import type { IRateLimitHealthPort } from 'src/core/security/rate-limiting/port/rate-limit-health.port';
import { TOKEN_RATE_LIMIT_CONNECTION } from 'src/core/security/rate-limiting/rate-limit-connection.token';

/**
 * Checks connectivity without invoking the counter algorithm or changing admission state.
 */
@Injectable()
export class RateLimitHealthAdapter implements IRateLimitHealthPort {
    /**
     * Maximum time to wait for the probe response, in milliseconds.
     */
    private readonly timeoutMs: number;

    /**
     * Connects health checks to the concern-owned Redis client.
     *
     * @param redis Existing rate-limit Redis connection.
     * @param configService Validated command timeout configuration.
     */
    constructor(
        @Inject(TOKEN_RATE_LIMIT_CONNECTION) private readonly redis: RedisClientType,
        configService: ConfigService,
    ) {
        this.timeoutMs = configService.getOrThrow<number>(ENV.REDIS_RATE_LIMIT_COMMAND_TIMEOUT) * 1000;
    }

    /**
     * Waits for a PING response without delaying health checks indefinitely.
     */
    async ping() {
        let timer: ReturnType<typeof setTimeout> | undefined;

        try {
            await Promise.race([
                this.redis.ping(),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new TimeoutError()), this.timeoutMs);
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    }
}
