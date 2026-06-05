/**
 * @file postgres-health.indicator.ts
 * @description Implementation of PostgreSQL health verification using Drizzle ORM.
 */

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE } from '../constant/database.constant';
import { IDatabaseHealthIndicator } from '../interface/database-health-indicator.interface';

/**
 * PostgreSQL health indicator implementation that queries Postgres via Drizzle to verify connection.
 */
@Injectable()
export class PostgresHealthIndicator implements IDatabaseHealthIndicator {
    /**
     * Creates an instance of PostgresHealthIndicator.
     *
     * @param db Configured Drizzle database client instance.
     */
    constructor(@Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase) {}

    /**
     * Executes a simple 'SELECT 1' query to verify active connection to the database.
     *
     * @throws {Error} If the database connection test fails.
     */
    async ping() {
        await this.db.execute(sql`SELECT 1`);
    }
}
