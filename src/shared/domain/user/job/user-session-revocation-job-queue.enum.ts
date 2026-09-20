/**
 * @file user-session-revocation-job-queue.enum.ts
 * @description Defines cross-context session-revocation queues owned by the User bounded context.
 */

/**
 * Durable User session-revocation queues available to cross-context producers.
 */
export enum UserSessionRevocationJobQueue {
    /**
     * Revokes every session after an explicit logout-all request.
     */
    LOGOUT_ALL = 'user.session-revocation.logout-all.queue.v1',

    /**
     * Revokes every session after refresh-token reuse is detected.
     */
    REFRESH_REUSE = 'user.session-revocation.refresh-reuse.queue.v1',
}
