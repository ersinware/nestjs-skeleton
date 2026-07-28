/**
 * @file module.ts
 * @description NestJS module wiring the PostgreSQL connection pool, the Drizzle ORM client, and the
 * database ports, and closing the pool on application shutdown.
 */

import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ENV } from 'src/core/config';
import { DatabaseCleanerAdapter } from 'src/core/database/adapter/database-cleaner.adapter';
import { DatabaseHealthAdapter } from 'src/core/database/adapter/database-health.adapter';
import { TOKEN_DATABASE_CLIENT } from 'src/core/database/database-client.token';
import { TOKEN_DATABASE_CLEANER_PORT } from 'src/core/database/port/database-cleaner.port';
import { TOKEN_DATABASE_HEALTH_PORT } from 'src/core/database/port/database-health.port';
import { LoggerModule } from 'src/core/observability/logger';

/**
 * Dependency injection token for the raw postgres.js connection pool. Module-private: consumers see
 * only the Drizzle client; the raw pool exists solely to be wrapped and closed on shutdown.
 */
const TOKEN_POSTGRES_CONNECTION = Symbol('TOKEN_POSTGRES_CONNECTION');

/**
 * Provides the Drizzle database client and the database health port to other modules.
 */
@Module({
    imports: [LoggerModule],
    providers: [
        {
            provide: TOKEN_POSTGRES_CONNECTION,
            useFactory: (configService: ConfigService) => {
                return postgres(configService.getOrThrow<string>(ENV.DATABASE_URL), {
                    max: configService.getOrThrow<number>(ENV.DATABASE_POOL_SIZE),
                    connect_timeout: configService.getOrThrow<number>(ENV.DATABASE_CONNECT_TIMEOUT),
                    idle_timeout: configService.getOrThrow<number>(ENV.DATABASE_IDLE_TIMEOUT),
                    max_lifetime: configService.getOrThrow<number>(ENV.DATABASE_MAX_LIFETIME),
                });
            },
            inject: [ConfigService],
        },
        {
            inject: [TOKEN_POSTGRES_CONNECTION],
            provide: TOKEN_DATABASE_CLIENT,
            useFactory: (pgConnection: postgres.Sql): PostgresJsDatabase => drizzle(pgConnection),
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
     * @param pg Raw connection pool.
     */
    constructor(@Inject(TOKEN_POSTGRES_CONNECTION) private readonly pg: postgres.Sql) {}

    /**
     * Closes every pooled connection gracefully on application shutdown.
     */
    async onApplicationShutdown() {
        await this.pg.end();
    }
}
