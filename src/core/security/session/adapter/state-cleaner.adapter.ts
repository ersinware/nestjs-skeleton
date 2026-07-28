/**
 * @file state-cleaner.adapter.ts
 * @description Implementation of state Redis cleaning operations for end-to-end testing environments.
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import type { IStateCleanerPort } from 'src/core/security/session/port/state-cleaner.port';
import { TOKEN_STATE_CONNECTION } from 'src/core/security/session/state-connection.token';

/**
 * State store cleaner utility flushing keys to reset sessions during test suites.
 */
@Injectable()
export class StateCleanerAdapter implements IStateCleanerPort {
    /**
     * Creates an instance of StateCleanerAdapter.
     *
     * @param stateRedis Configured state Redis client instance.
     */
    constructor(@Inject(TOKEN_STATE_CONNECTION) private readonly stateRedis: Redis) {}

    /**
     * Flushes all keys from the state Redis instance.
     */
    async cleanup() {
        await this.stateRedis.flushall();
    }
}
