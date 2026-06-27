/**
 * @file database-cleaner.interface.ts
 * @description Interface contract for database schema cleaning operations during testing.
 */

/**
 * Interface defining operations to truncate and reset database tables.
 */
export interface IDatabaseCleaner {
    /**
     * Resets database tables by truncating and restarting identity sequences.
     *
     * @returns A promise that resolves when the database has been successfully cleaned.
     */
    cleanup(): Promise<void>;
}
