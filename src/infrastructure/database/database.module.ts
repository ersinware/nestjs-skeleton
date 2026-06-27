/**
 * @file database.module.ts
 * @description Global NestJS module establishing database connections and configuring Drizzle ORM.
 * Connects to PostgreSQL using postgres.js and manages connections gracefully across the application lifecycle.
 */

import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ENV } from 'src/common/config/constant/env.constant';
import {
    TOKEN_DATABASE,
    TOKEN_DATABASE_CLEANER,
    TOKEN_DATABASE_HEALTH_INDICATOR,
} from 'src/common/port/database/database.constant';
import { PostgresCleaner } from './service/postgres-cleaner.service';
import { PostgresHealthIndicator } from './service/postgres-health.indicator';
import * as schema from './schema';

/**
 * Dependency injection token representing the raw postgres.js client connection pool.
 */
const TOKEN_DATABASE_CLIENT = Symbol('TOKEN_DATABASE_CLIENT');

/**
 * Global database module providing database clients to other modules.
 */
@Global()
@Module({
    imports: [],
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
            useFactory: (pgConnection: postgres.Sql) => {
                return drizzle(pgConnection, { schema });
            },
        },
        {
            provide: TOKEN_DATABASE_CLEANER,
            useClass: PostgresCleaner,
        },
        {
            provide: TOKEN_DATABASE_HEALTH_INDICATOR,
            useClass: PostgresHealthIndicator,
        },
    ],
    exports: [TOKEN_DATABASE, TOKEN_DATABASE_CLEANER, TOKEN_DATABASE_HEALTH_INDICATOR],
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
