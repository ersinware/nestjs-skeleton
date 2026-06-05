/**
 * @file postgres-cleaner.service.ts
 * @description Implementation of PostgreSQL database cleaning operations for end-to-end testing environments.
 */

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE } from '../constant/database.constant';
import type { IDatabaseCleaner } from '../interface/database-cleaner.interface';

/**
 * PostgreSQL database cleaner utility executing truncation queries to reset table states during test suites.
 */
@Injectable()
export class PostgresCleaner implements IDatabaseCleaner {
    /**
     * Creates an instance of PostgresCleaner.
     *
     * @param db Drizzle database client instance.
     */
    constructor(@Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase) {}

    /**
     * Dynamically truncates all tables in the public schema and restarts their identity sequences.
     * This ensures all database state is reset between tests without hardcoding table names.
     *
     * @throws {Error} If the database query execution fails.
     */
    async cleanup() {
        await this.db.execute(sql`
            DO $$ DECLARE
                r RECORD;
            BEGIN
                FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
                    EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
                END LOOP;
            END $$;
        `);
    }
}
