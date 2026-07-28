/**
 * @file state-health.adapter.ts
 * @description Implementation of state Redis health verification using the configured client.
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import type { IStateHealthPort } from 'src/core/security/session/port/state-health.port';
import { TOKEN_STATE_CLIENT } from 'src/core/security/session/state-client.token';

/**
 * State health indicator implementation that queries the client via ping to verify connection.
 */
@Injectable()
export class StateHealthAdapter implements IStateHealthPort {
    /**
     * Creates an instance of StateHealthAdapter.
     *
     * @param stateRedis Configured state Redis client instance.
     */
    constructor(@Inject(TOKEN_STATE_CLIENT) private readonly stateRedis: Redis) {}

    /**
     * Sends a ping query to verify connection to the state Redis instance.
     */
    async ping() {
        await this.stateRedis.ping();
    }
}
