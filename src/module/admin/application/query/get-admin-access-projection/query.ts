/**
 * @file query.ts
 * @description Read-model for the get-admin-access-projection query. Includes soft-deleted rows so
 * session reconciliation can converge on the true current state. This query has no `handler.ts`, so it
 * is invoked directly through its port from inside the application layer (see the read-transport rule
 * in CLAUDE.md) rather than dispatched via the QueryBus.
 */

/**
 * The result of reading the access projection: the current session version, or null when no row
 * exists. Session reconciliation only needs the version to push into Redis.
 */
export type GetAdminAccessProjectionResult = {
    version: number;
};
