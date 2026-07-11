/**
 * @file database-cleaner.port.ts
 * @description Interface contract for database schema cleaning operations during testing.
 */

/**
 * Dependency injection token representing the database cleaner utility.
 */
export const TOKEN_DATABASE_CLEANER_PORT = Symbol('TOKEN_DATABASE_CLEANER_PORT');

/**
 * Interface defining operations to truncate and reset database tables.
 */
export interface IDatabaseCleanerPort {
    /**
     * Resets database tables by truncating and restarting identity sequences.
     *
     * @returns A promise that resolves when the database has been successfully cleaned.
     */
    cleanup(): Promise<void>;
}
