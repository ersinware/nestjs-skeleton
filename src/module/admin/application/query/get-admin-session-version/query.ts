/**
 * @file query.ts
 * @description Read-model of the get-admin-session-version query. No `handler.ts`: its only consumer
 * is a command handler, which reads through the port directly (CLAUDE.md read-transport rule).
 */

/**
 * The admin's current session version — all reconciliation needs to push into Redis.
 */
export type GetAdminSessionVersionResult = {
    readonly sessionVersion: number;
};
