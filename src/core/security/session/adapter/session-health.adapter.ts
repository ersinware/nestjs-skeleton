/**
 * @file session-health.adapter.ts
 * @description Session store implementation of the health probe contract.
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import type { ISessionHealthPort } from 'src/core/security/session/port/session-health.port';
import { TOKEN_SESSION_CONNECTION } from 'src/core/security/session/session-connection.token';

/**
 * Verifies session store connectivity with a PING over the configured client.
 */
@Injectable()
export class SessionHealthAdapter implements ISessionHealthPort {
    /**
     * @param sessionRedis The session store Redis client.
     */
    constructor(@Inject(TOKEN_SESSION_CONNECTION) private readonly sessionRedis: Redis) {}

    /**
     * Pings the session store.
     */
    async ping() {
        await this.sessionRedis.ping();
    }
}
