/**
 * @file user-job-queue.enum.ts
 * @description Defines queues owned by the User aggregate.
 */

/**
 * Durable job queues owned by the User bounded context.
 */
export enum UserJobQueue {
    /**
     * Sends confirmation to the pending email address for the stored request.
     */
    EMAIL_CONFIRMATION = 'user.email-confirmation.queue.v1',

    /**
     * Invalidates the cached user projection.
     */
    CACHE_INVALIDATE = 'user.cache-invalidate.queue.v1',

    /**
     * Notifies a user after refresh-token reuse revokes all sessions.
     */
    REFRESH_REUSE_NOTICE = 'user.refresh-reuse-notice.queue.v1',

    /**
     * Reconciles the persisted session version with the session store.
     */
    SESSION_RECONCILE = 'user.session-reconcile.queue.v1',
}
