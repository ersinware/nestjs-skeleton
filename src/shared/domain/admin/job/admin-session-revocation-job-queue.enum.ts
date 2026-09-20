/**
 * @file admin-session-revocation-job-queue.enum.ts
 * @description Defines cross-context session-revocation queues owned by the Admin bounded context.
 */

/**
 * Durable Admin session-revocation queues available to cross-context producers.
 */
export enum AdminSessionRevocationJobQueue {
    /**
     * Revokes every session after an explicit logout-all request.
     */
    LOGOUT_ALL = 'admin.session-revocation.logout-all.queue.v1',

    /**
     * Revokes every session after refresh-token reuse is detected.
     */
    REFRESH_REUSE = 'admin.session-revocation.refresh-reuse.queue.v1',
}
