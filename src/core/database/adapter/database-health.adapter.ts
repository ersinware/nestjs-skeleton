/**
 * @file database-health.adapter.ts
 * @description Implementation of PostgreSQL health verification using Drizzle ORM.
 */

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE } from 'src/core/database/database-client.token';
import type { IDatabaseHealthPort } from 'src/core/database/port/database-health.port';
import { ConnectionLogMessage, LogPayload, TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';

/**
 * PostgreSQL health indicator implementation that queries Postgres via Drizzle to verify connection.
 */
@Injectable()
export class DatabaseHealthAdapter implements IDatabaseHealthPort {
    /**
     * Per-outage transition flag mirroring the Redis connection logs in `core/cache/module.ts`.
     * postgres.js exposes no connection-state events, so this periodic probe is the one place a DB
     * outage's root cause can be recorded — once per episode, never per failing request.
     */
    private isDown = false;

    /**
     * Creates an instance of PostgresHealthIndicatorAdapter.
     *
     * @param db Configured Drizzle database client instance.
     * @param loggerPort The port used to record the outage-transition breadcrumbs.
     */
    constructor(
        @Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
    ) {}

    /**
     * Executes a simple 'SELECT 1' query to verify active connection to the database.
     *
     * On failure the driver error is logged once per outage episode as the forensic breadcrumb — the
     * health-endpoint alarm brings the operator in, this warn names the cause — and then rethrown so
     * the health indicator reports the database as down.
     *
     * @throws {Error} If the database connection test fails.
     */
    async ping() {
        try {
            await this.db.execute(sql`SELECT 1`);
        } catch (error) {
            if (!this.isDown) {
                this.isDown = true;
                this.loggerPort.warn(
                    new LogPayload({
                        class: this.constructor.name,
                        method: this.ping.name,
                        message: ConnectionLogMessage.LOST,
                        error,
                    }),
                );
            }

            throw error;
        }

        if (this.isDown) {
            this.isDown = false;
            this.loggerPort.log(
                new LogPayload({
                    class: this.constructor.name,
                    method: this.ping.name,
                    message: ConnectionLogMessage.RESTORED,
                }),
            );
        }
    }
}
