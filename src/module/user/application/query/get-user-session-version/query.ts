/**
 * @file query.ts
 * @description Read-model of the get-user-session-version query. No `handler.ts`: its only consumer
 * is a command handler, which reads through the port directly (agent/architecture.md#cqrs).
 */

/**
 * The user's current session version — all reconciliation needs to push into Redis.
 */
export type GetUserSessionVersionResult = {
    /**
     * Current version to reconcile into the session store.
     */
    readonly sessionVersion: number;
};
