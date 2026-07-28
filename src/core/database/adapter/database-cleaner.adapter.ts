/**
 * @file database-cleaner.adapter.ts
 * @description PostgreSQL adapter of the database cleaner port, wiping table state between test runs.
 */

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE_CLIENT } from 'src/core/database/database-client.token';
import type { IDatabaseCleanerPort } from 'src/core/database/port/database-cleaner.port';

/**
 * PostgreSQL implementation of the database cleaner port, truncating all application tables.
 */
@Injectable()
export class DatabaseCleanerAdapter implements IDatabaseCleanerPort {
    constructor(@Inject(TOKEN_DATABASE_CLIENT) private readonly db: PostgresJsDatabase) {}

    /**
     * Truncates every table outside the PostgreSQL system schemas and Drizzle's migration
     * bookkeeping. Discovering schemas at runtime keeps the cleaner correct as bounded contexts add
     * their own logical schemas. No `CASCADE`/`RESTART IDENTITY`: modules link by plain UUID columns
     * (no FK constraints) and keys are UUIDs (no identity sequences), so both clauses would be dead
     * weight.
     *
     * @throws {Error} If the truncation query fails.
     */
    async cleanup() {
        await this.db.execute(sql`
            DO $$ DECLARE
                r RECORD;
            BEGIN
                FOR r IN (
                    SELECT schemaname, tablename FROM pg_tables
                    WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'drizzle')
                ) LOOP
                    EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.schemaname) || '.' || quote_ident(r.tablename);
                END LOOP;
            END $$;
        `);
    }
}
