/**
 * @file database.cleaner.ts
 * @description Utility functions to wipe PostgreSQL database state between E2E test cycles.
 */

import { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { IDatabaseCleanerPort } from 'src/core/database';
import { TOKEN_DATABASE_CLEANER_PORT } from 'src/core/database';

/**
 * Invokes the database cleaner provider to reset all data tables during test cycles.
 *
 * @param app The running NestFastifyApplication instance.
 */
export async function cleanupDatabase(app: NestFastifyApplication): Promise<void> {
    await app.get<IDatabaseCleanerPort>(TOKEN_DATABASE_CLEANER_PORT).cleanup();
}
