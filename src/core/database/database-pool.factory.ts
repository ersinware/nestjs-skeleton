/**
 * @file database-pool.factory.ts
 * @description Factory building configured business and delivery pools with shared connection limits.
 */

import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { ENV } from 'src/core/config';

/**
 * Creates a connection pool for the given endpoint.
 *
 * @param configService Source of the pool limits
 * @param connectionString The endpoint to connect to
 * @param max Maximum connections for this pool
 * @returns The configured pool
 */
export function createDatabasePool(configService: ConfigService, connectionString: string, max: number): Pool {
    const pool = new Pool({
        connectionString,
        max,
        // Timeout env values are seconds; pg expects milliseconds except maxLifetimeSeconds.
        connectionTimeoutMillis: configService.getOrThrow<number>(ENV.DATABASE_CONNECT_TIMEOUT) * 1000,
        statement_timeout: configService.getOrThrow<number>(ENV.DATABASE_STATEMENT_TIMEOUT) * 1000,
        query_timeout: configService.getOrThrow<number>(ENV.DATABASE_QUERY_TIMEOUT) * 1000,
        idleTimeoutMillis: configService.getOrThrow<number>(ENV.DATABASE_IDLE_TIMEOUT) * 1000,
        maxLifetimeSeconds: configService.getOrThrow<number>(ENV.DATABASE_MAX_LIFETIME),
        // Every session in UTC, whatever the server's own setting: time-zone-less `timestamp`
        // columns hold UTC by convention, and `now()` (`defaultNow()`) renders in the session zone.
        options: '-c TimeZone=UTC',
    });

    // An idle pooled client the server drops surfaces here, and with no listener the driver
    // escalates it to an uncaught exception. The client is already discarded by the pool and the
    // next checkout reconnects, so the connection owner records the outage once: business health probes or delivery SQL
    // observations (§ Dependency outages).
    pool.on('error', () => {});

    return pool;
}
