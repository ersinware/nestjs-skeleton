/**
 * @file database.module.ts
 * @description Global NestJS module establishing database connections and configuring Drizzle ORM.
 * Connects to PostgreSQL using postgres.js and manages connections gracefully across the application lifecycle.
 */

import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ENV } from 'src/core/config';
import { DatabaseCleanerAdapter, DatabaseHealthAdapter } from 'src/core/database/adapter';
import { TOKEN_DATABASE } from 'src/core/database/constant';
import { TOKEN_DATABASE_CLEANER_PORT, TOKEN_DATABASE_HEALTH_PORT } from 'src/core/database/port';
import { transactionStorage } from 'src/core/database/util';
import { OutboxModule } from 'src/core/outbox';

/**
 * Dependency injection token representing the raw postgres.js client connection pool.
 */
const TOKEN_DATABASE_CLIENT = Symbol('TOKEN_DATABASE_CLIENT');

/**
 * Global database module providing database clients to other modules.
 */
@Global()
@Module({
    imports: [OutboxModule],
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
             * Drizzle ORM client factory with Global Database Proxy.
             *
             * This proxy intercepts all database operations (e.g., db.insert, db.query) and automatically
             * routes them to the active transaction if one exists in the current AsyncLocalStorage context.
             * If no transaction is active, it falls back to the global `drizzleDb` target.
             *
             * It utilizes `Reflect.get` and `.bind` to ensure the JavaScript `this` context is strictly
             * preserved, preventing Drizzle from executing queries outside the transaction boundary,
             * while fully satisfying TypeScript/ESLint strict mode constraints.
             *
             * @param pgConnection Raw PostgreSQL client connection pool.
             * @returns A proxied PostgresJsDatabase instance.
             */
            useFactory: (pgConnection: postgres.Sql): PostgresJsDatabase => {
                const dbDrizzle = drizzle(pgConnection);

                return new Proxy(dbDrizzle, {
                    get(target: object, prop: string | symbol) {
                        const db = transactionStorage.getStore() ?? target,
                            value = Reflect.get(db, prop) as unknown;

                        return typeof value === 'function'
                            ? (value as (...args: unknown[]) => unknown).bind(db)
                            : value;
                    },
                }) as PostgresJsDatabase;
            },
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
