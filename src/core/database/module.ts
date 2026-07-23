/**
 * @file database.module.ts
 * @description NestJS module establishing database connections and configuring Drizzle ORM.
 * Connects to PostgreSQL using postgres.js and manages connections gracefully across the application lifecycle.
 */

import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ENV } from 'src/core/config';
import { DatabaseCleanerAdapter } from 'src/core/database/adapter/database-cleaner.adapter';
import { DatabaseHealthAdapter } from 'src/core/database/adapter/database-health.adapter';
import { TOKEN_DATABASE } from 'src/core/database/database-client.token';
import { TOKEN_DATABASE_CLEANER_PORT } from 'src/core/database/port/database-cleaner.port';
import { TOKEN_DATABASE_HEALTH_PORT } from 'src/core/database/port/database-health.port';
import { LoggerModule } from 'src/core/observability/logger';

/**
 * Dependency injection token representing the raw postgres.js client connection pool.
 */
const TOKEN_DATABASE_CLIENT = Symbol('TOKEN_DATABASE_CLIENT');

/**
 * Database module providing database clients to other modules.
 */
@Module({
    imports: [LoggerModule],
    providers: [
        {
            provide: TOKEN_DATABASE_CLIENT,
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
            inject: [TOKEN_DATABASE_CLIENT],
            provide: TOKEN_DATABASE,
            /**
             * Drizzle ORM client factory.
             *
             * @param pgConnection Raw PostgreSQL client connection pool.
             * @returns A PostgresJsDatabase instance.
             */
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
    exports: [TOKEN_DATABASE, TOKEN_DATABASE_CLEANER_PORT, TOKEN_DATABASE_HEALTH_PORT],
})
export class DatabaseModule implements OnApplicationShutdown {
    /**
     * Creates an instance of DatabaseModule.
     *
     * @param pg Raw PostgreSQL client connection pool.
     */
    constructor(@Inject(TOKEN_DATABASE_CLIENT) private readonly pg: postgres.Sql) {}

    /**
     * NestJS lifecycle hook called when the application is shutting down.
     * Ensures all active connections in the PostgreSQL client pool are closed gracefully.
     */
    async onApplicationShutdown() {
        await this.pg.end();
    }
}
