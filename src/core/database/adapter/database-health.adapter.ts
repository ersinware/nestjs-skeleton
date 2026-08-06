/**
 * @file database-health.adapter.ts
 * @description PostgreSQL adapter of the database health port, doubling as the outage-transition
 * logging site.
 */

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE_CLIENT } from 'src/core/database/database-client.token';
import type { IDatabaseHealthPort } from 'src/core/database/port/database-health.port';
import { ConnectionLogMessage, TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';

/**
 * PostgreSQL implementation of the database health port, verifying connectivity via Drizzle.
 */
@Injectable()
export class DatabaseHealthAdapter implements IDatabaseHealthPort {
    /**
     * Outage-transition flag. postgres.js exposes no connection-state events, so this periodic probe
     * is the one place a database outage's root cause is recorded — once per episode, never per
     * failing request.
     */
    private isDown = false;

    /**
     * Initializes the probe with the database connection and the logger.
     *
     * @param db The PostgresJs database instance
     * @param loggerPort The port the outage transitions are logged on
     */
    constructor(
        @Inject(TOKEN_DATABASE_CLIENT) private readonly db: PostgresJsDatabase,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
    ) {}

    /**
     * Verifies connectivity with a `SELECT 1` query. On failure the driver error is logged once per
     * outage episode — the health alarm brings the operator in, this warn names the cause — and then
     * rethrown so the health indicator reports the database as down.
     *
     * @throws {Error} If the connectivity query fails.
     */
    async ping() {
        try {
            await this.db.execute(sql`SELECT 1`);
        } catch (error) {
            if (!this.isDown) {
                this.isDown = true;
                this.loggerPort.warn({
                    class: this.constructor.name,
                    method: this.ping.name,
                    message: ConnectionLogMessage.LOST,
                    error,
                });
            }

            throw error;
        }

        if (this.isDown) {
            this.isDown = false;
            this.loggerPort.info({
                class: this.constructor.name,
                method: this.ping.name,
                message: ConnectionLogMessage.RESTORED,
            });
        }
    }
}
