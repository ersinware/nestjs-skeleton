/**
 * @file database-health.adapter.ts
 * @description Implementation of PostgreSQL health verification using Drizzle ORM.
 */

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE } from 'src/core/database/constant';
import type { IDatabaseHealthPort } from 'src/core/database/port/database-health.port';

/**
 * PostgreSQL health indicator implementation that queries Postgres via Drizzle to verify connection.
 */
@Injectable()
export class DatabaseHealthAdapter implements IDatabaseHealthPort {
    /**
     * Creates an instance of PostgresHealthIndicatorAdapter.
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
