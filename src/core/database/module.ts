/**
 * @file module.ts
 * @description NestJS module wiring the primary and replica PostgreSQL pools, their Drizzle clients
 * and the database ports, and closing the pools on application shutdown.
 */

import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { ENV } from 'src/core/config';
import { DatabaseCleanerAdapter } from 'src/core/database/adapter/database-cleaner.adapter';
import { DatabaseHealthAdapter } from 'src/core/database/adapter/database-health.adapter';
import { TOKEN_DATABASE_CLIENT, TOKEN_DATABASE_REPLICA_CLIENT } from 'src/core/database/database-client.token';
import { createDatabasePool } from 'src/core/database/database-pool.factory';
import { DatabaseRole } from 'src/core/database/database-role.enum';
import { TOKEN_DATABASE_CLEANER_PORT } from 'src/core/database/port/database-cleaner.port';
import {
    TOKEN_DATABASE_HEALTH_PORT,
    TOKEN_DATABASE_REPLICA_HEALTH_PORT,
    type IDatabaseHealthPort,
} from 'src/core/database/port/database-health.port';
import { LoggerModule, TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';

/**
 * Dependency injection token for the raw primary pool. Module-private: consumers see only the
 * Drizzle clients; the raw pools exist to be wrapped and closed on shutdown.
 */
const TOKEN_DATABASE_CONNECTION = Symbol('TOKEN_DATABASE_CONNECTION');

/**
 * Dependency injection token for the raw replica pool. Module-private. Resolves to the primary pool
 * object itself when `DATABASE_REPLICA_URL` is unset; that identity is the single source of "is a
 * replica configured" for every provider below.
 */
const TOKEN_DATABASE_REPLICA_CONNECTION = Symbol('TOKEN_DATABASE_REPLICA_CONNECTION');

/**
 * Provides the primary and replica Drizzle clients and their health ports. Without a replica URL,
 * every replica-bound provider collapses onto its primary counterpart — one pool, one client, one
 * probe — so the deployment alone decides whether a real replica serves the replica token.
 */
@Module({
    imports: [LoggerModule],
    providers: [
        {
            provide: TOKEN_DATABASE_CONNECTION,
            useFactory: (configService: ConfigService): Pool =>
                createDatabasePool(
                    configService,
                    configService.getOrThrow<string>(ENV.DATABASE_URL),
                    configService.getOrThrow<number>(ENV.DATABASE_POOL_SIZE),
                ),
            inject: [ConfigService],
        },
        {
            provide: TOKEN_DATABASE_REPLICA_CONNECTION,
            // '' counts as unset: when validation dropped the key, `ConfigService` falls back to the
            // raw `process.env` value, which an empty `DATABASE_REPLICA_URL=` line delivers as ''.
            useFactory: (configService: ConfigService, primaryPool: Pool): Pool => {
                const replicaUrl = configService.get<string>(ENV.DATABASE_REPLICA_URL);

                return replicaUrl
                    ? createDatabasePool(
                          configService,
                          replicaUrl,
                          configService.get<number>(ENV.DATABASE_REPLICA_POOL_SIZE) ??
                              configService.getOrThrow<number>(ENV.DATABASE_POOL_SIZE),
                      )
                    : primaryPool;
            },
            inject: [ConfigService, TOKEN_DATABASE_CONNECTION],
        },
        {
            provide: TOKEN_DATABASE_CLIENT,
            // The app side of the UTC convention: Drizzle alone interprets timestamps — it
            // overrides the driver's zone-dependent date parsers on every query (raw `execute`
            // included) and appends `+0000` itself. The pools are module-private, so no query can
            // reach the driver's own parsers.
            useFactory: (pool: Pool): NodePgDatabase => drizzle({ client: pool }),
            inject: [TOKEN_DATABASE_CONNECTION],
        },
        {
            provide: TOKEN_DATABASE_REPLICA_CLIENT,
            useFactory: (replicaPool: Pool, primaryPool: Pool, primaryClient: NodePgDatabase): NodePgDatabase =>
                replicaPool === primaryPool ? primaryClient : drizzle({ client: replicaPool }),
            inject: [TOKEN_DATABASE_REPLICA_CONNECTION, TOKEN_DATABASE_CONNECTION, TOKEN_DATABASE_CLIENT],
        },
        {
            provide: TOKEN_DATABASE_CLEANER_PORT,
            useClass: DatabaseCleanerAdapter,
        },
        {
            provide: TOKEN_DATABASE_HEALTH_PORT,
            useFactory: (db: NodePgDatabase, loggerPort: ILoggerPort): IDatabaseHealthPort =>
                new DatabaseHealthAdapter(db, loggerPort, DatabaseRole.PRIMARY),
            inject: [TOKEN_DATABASE_CLIENT, TOKEN_LOGGER_PORT],
        },
        {
            provide: TOKEN_DATABASE_REPLICA_HEALTH_PORT,
            // Without a replica this is the primary's probe object, not a second probe over the
            // same pool: one outage logs one LOST/RESTORED pair, under the right role.
            useFactory: (
                replicaPool: Pool,
                primaryPool: Pool,
                replicaClient: NodePgDatabase,
                primaryHealthPort: IDatabaseHealthPort,
                loggerPort: ILoggerPort,
            ): IDatabaseHealthPort =>
                replicaPool === primaryPool
                    ? primaryHealthPort
                    : new DatabaseHealthAdapter(replicaClient, loggerPort, DatabaseRole.REPLICA),
            inject: [
                TOKEN_DATABASE_REPLICA_CONNECTION,
                TOKEN_DATABASE_CONNECTION,
                TOKEN_DATABASE_REPLICA_CLIENT,
                TOKEN_DATABASE_HEALTH_PORT,
                TOKEN_LOGGER_PORT,
            ],
        },
    ],
    exports: [
        TOKEN_DATABASE_CLIENT,
        TOKEN_DATABASE_REPLICA_CLIENT,
        TOKEN_DATABASE_HEALTH_PORT,
        TOKEN_DATABASE_REPLICA_HEALTH_PORT,
    ],
})
export class DatabaseModule implements OnApplicationShutdown {
    /**
     * @param primaryPool Raw pool of the primary connection.
     * @param replicaPool Raw pool of the replica connection; the primary's pool when none is configured.
     */
    constructor(
        @Inject(TOKEN_DATABASE_CONNECTION) private readonly primaryPool: Pool,
        @Inject(TOKEN_DATABASE_REPLICA_CONNECTION) private readonly replicaPool: Pool,
    ) {}

    /**
     * Closes every pool on application shutdown; the shared pool is ended once.
     */
    async onApplicationShutdown() {
        await this.primaryPool.end();

        if (this.replicaPool !== this.primaryPool) {
            await this.replicaPool.end();
        }
    }
}
