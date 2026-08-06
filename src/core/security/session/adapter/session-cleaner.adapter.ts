/**
 * @file session-cleaner.adapter.ts
 * @description Session store implementation of the cleaner contract.
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import type { ISessionCleanerPort } from 'src/core/security/session/port/session-cleaner.port';
import { TOKEN_SESSION_CONNECTION } from 'src/core/security/session/session-connection.token';

/**
 * Wipes the session store via FLUSHALL so test cycles start from a clean slate.
 */
@Injectable()
export class SessionCleanerAdapter implements ISessionCleanerPort {
    /**
     * @param sessionRedis The session store Redis client.
     */
    constructor(@Inject(TOKEN_SESSION_CONNECTION) private readonly sessionRedis: Redis) {}

    /**
     * Flushes all keys from the session store.
     */
    async cleanup() {
        await this.sessionRedis.flushall();
    }
}
