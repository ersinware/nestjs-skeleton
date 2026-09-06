/**
 * @file module.ts
 * @description NestJS module wiring the PostgreSQL connection pool, the Drizzle ORM client, and the
 * database ports, and closing the pool on application shutdown.
 */

import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { ENV } from 'src/core/config';
import { DatabaseCleanerAdapter } from 'src/core/database/adapter/database-cleaner.adapter';
import { DatabaseHealthAdapter } from 'src/core/database/adapter/database-health.adapter';
import { TOKEN_DATABASE_CLIENT } from 'src/core/database/database-client.token';
import { TOKEN_DATABASE_CLEANER_PORT } from 'src/core/database/port/database-cleaner.port';
import { TOKEN_DATABASE_HEALTH_PORT } from 'src/core/database/port/database-health.port';
import { LoggerModule } from 'src/core/observability/logger';

/**
 * Dependency injection token for the raw node-postgres pool. Module-private: consumers see only
 * the Drizzle client; the raw pool exists solely to be wrapped and closed on shutdown.
 */
const TOKEN_DATABASE_CONNECTION = Symbol('TOKEN_DATABASE_CONNECTION');

/**
 * Provides the Drizzle database client and the database health port to other modules.
 */
@Module({
    imports: [LoggerModule],
    providers: [
        {
            provide: TOKEN_DATABASE_CONNECTION,
            useFactory: (configService: ConfigService) => {
                const pool = new Pool({
                    connectionString: configService.getOrThrow<string>(ENV.DATABASE_URL),
                    max: configService.getOrThrow<number>(ENV.DATABASE_POOL_SIZE),
                    // The env contract is in seconds; the driver takes milliseconds for these two.
                    connectionTimeoutMillis: configService.getOrThrow<number>(ENV.DATABASE_CONNECT_TIMEOUT) * 1000,
                    idleTimeoutMillis: configService.getOrThrow<number>(ENV.DATABASE_IDLE_TIMEOUT) * 1000,
                    maxLifetimeSeconds: configService.getOrThrow<number>(ENV.DATABASE_MAX_LIFETIME),
                    // Every session in UTC, whatever the server's own setting: time-zone-less
                    // `timestamp` columns hold UTC by convention, and `now()` (`defaultNow()`) renders
                    // in the session zone.
                    options: '-c TimeZone=UTC',
                });

                // An idle pooled client the server drops surfaces here, and with no listener the
                // driver escalates it to an uncaught exception. The client is already discarded by
                // the pool and the next checkout reconnects, so nothing is left to do; the outage is
                // recorded once, by the health probe (§ Dependency outages).
                pool.on('error', () => {});

                return pool;
            },
            inject: [ConfigService],
        },
        {
            inject: [TOKEN_DATABASE_CONNECTION],
            provide: TOKEN_DATABASE_CLIENT,
            // The app side of the UTC convention: Drizzle alone interprets timestamps — it
            // overrides the driver's zone-dependent date parsers on every query (raw `execute`
            // included, which hands back the string) and appends `+0000` itself. The pool is
            // module-private, so no query can reach the driver's own parsers.
            useFactory: (pool: Pool): NodePgDatabase => drizzle({ client: pool }),
        },
        {
            provide: TOKEN_DATABASE_CLEANER_PORT,
            useClass: DatabaseCleanerAdapter,
        },
        {
            provide: TOKEN_DATABASE_HEALTH_PORT,
            useClass: DatabaseHealthAdapter,
        },
    ],
    exports: [TOKEN_DATABASE_CLIENT, TOKEN_DATABASE_HEALTH_PORT],
})
export class DatabaseModule implements OnApplicationShutdown {
    /**
     * @param pool Raw connection pool.
     */
    constructor(@Inject(TOKEN_DATABASE_CONNECTION) private readonly pool: Pool) {}

    /**
     * Closes every pooled connection gracefully on application shutdown.
     */
    async onApplicationShutdown() {
        await this.pool.end();
    }
}
