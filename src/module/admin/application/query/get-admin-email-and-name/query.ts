/**
 * @file query.ts
 * @description Read-model for the get-admin-email-and-name query. This query has no `handler.ts`, so it
 * is invoked directly through its port from inside the application layer (see the read-transport rule
 * in CLAUDE.md) rather than dispatched via the QueryBus.
 */

/**
 * The email and name projection of an admin, read directly through the query port.
 */
export type GetAdminEmailAndNameResult = {
    email: string;
    name: string;
};
