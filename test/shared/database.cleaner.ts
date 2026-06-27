/**
 * @file database.cleaner.ts
 * @description Utility functions to wipe PostgreSQL database state between E2E test cycles.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TOKEN_DATABASE_CLEANER } from 'src/common/port/database/database.constant';
import type { IDatabaseCleaner } from 'src/common/port/database/database-cleaner.interface';

/**
 * Invokes the database cleaner provider to reset all data tables during test cycles.
 *
 * @param app The running NestFastifyApplication instance.
 */
export async function cleanupDatabase(app: NestFastifyApplication): Promise<void> {
    await app.get<IDatabaseCleaner>(TOKEN_DATABASE_CLEANER).cleanup();
}
