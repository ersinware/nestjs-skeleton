/**
 * @file database-pool.factory.ts
 * @description Factory building a configured node-postgres pool, shared by the primary and the
 * replica connection so pool policy lives in one place.
 */

import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { ENV } from 'src/core/config';

/**
 * Creates a connection pool for the given endpoint.
 *
 * @param configService Source of the pool limits
 * @param connectionString The endpoint to connect to
 * @returns The configured pool
 */
export function createDatabasePool(configService: ConfigService, connectionString: string): Pool {
    const pool = new Pool({
        connectionString,
        max: configService.getOrThrow<number>(ENV.DATABASE_POOL_SIZE),
        // The env contract is in seconds; the driver takes milliseconds for these two.
        connectionTimeoutMillis: configService.getOrThrow<number>(ENV.DATABASE_CONNECT_TIMEOUT) * 1000,
        idleTimeoutMillis: configService.getOrThrow<number>(ENV.DATABASE_IDLE_TIMEOUT) * 1000,
        maxLifetimeSeconds: configService.getOrThrow<number>(ENV.DATABASE_MAX_LIFETIME),
        // Every session in UTC, whatever the server's own setting: time-zone-less `timestamp`
        // columns hold UTC by convention, and `now()` (`defaultNow()`) renders in the session zone.
        options: '-c TimeZone=UTC',
    });

    // An idle pooled client the server drops surfaces here, and with no listener the driver
    // escalates it to an uncaught exception. The client is already discarded by the pool and the
    // next checkout reconnects, so nothing is left to do; the outage is recorded once, by the
    // health probe (§ Dependency outages).
    pool.on('error', () => {});

    return pool;
}
