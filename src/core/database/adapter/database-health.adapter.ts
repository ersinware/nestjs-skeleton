/**
 * @file database-health.adapter.ts
 * @description PostgreSQL adapter of the database health port, doubling as the outage-transition
 * logging site of the connection it probes.
 */

import { sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DatabaseRole } from 'src/core/database/database-role.enum';
import type { IDatabaseHealthPort } from 'src/core/database/port/database-health.port';
import { ConnectionLogMessage, type ILoggerPort } from 'src/core/observability/logger';

/**
 * PostgreSQL implementation of the database health port. One instance per connection, constructed
 * by the database module's factories: the outage flag is per connection, and the role names the
 * connection in the logs.
 */
export class DatabaseHealthAdapter implements IDatabaseHealthPort {
    /**
     * Outage-transition flag. The driver's pool reports only dropped idle clients, never a state, so
     * this periodic probe is the one place a database outage's root cause is recorded — once per
     * episode, never per failing request.
     */
    private isDown = false;

    /**
     * Initializes the probe with the connection it verifies and the logger.
     *
     * @param database The Drizzle client on the probed connection
     * @param loggerPort The port the outage transitions are logged on
     * @param role The probed connection's role, named in the transition logs
     */
    constructor(
        private readonly database: NodePgDatabase,
        private readonly loggerPort: ILoggerPort,
        private readonly role: DatabaseRole,
    ) {}

    /**
     * Verifies connectivity with a `SELECT 1` query. On failure the driver error is logged once per
     * outage episode — the health alarm brings the operator in, this warn names the cause — and then
     * rethrown so the health indicator reports the connection as down.
     */
    async ping() {
        try {
            await this.database.execute(sql`SELECT 1`);
        } catch (error) {
            if (!this.isDown) {
                this.isDown = true;
                this.loggerPort.warn({
                    class: this.constructor.name,
                    method: this.ping.name,
                    message: ConnectionLogMessage.LOST,
                    error,
                    data: { role: this.role },
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
                data: { role: this.role },
            });
        }
    }
}
