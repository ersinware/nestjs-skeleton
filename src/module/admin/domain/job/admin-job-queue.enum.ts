/**
 * @file admin-job-queue.enum.ts
 * @description Defines queues owned by the Admin aggregate.
 */

/**
 * Durable job queues owned by the Admin bounded context.
 */
export enum AdminJobQueue {
    /**
     * Copies and attaches an activated admin's immutable avatar.
     */
    AVATAR_MOVE = 'admin.avatar-move.queue.v1',

    /**
     * Notifies the previous address after a confirmed email change.
     */
    EMAIL_CHANGE_NOTIFICATION = 'admin.email-change-notification.queue.v1',

    /**
     * Sends confirmation to the pending email address for the stored request.
     */
    EMAIL_CONFIRMATION = 'admin.email-confirmation.queue.v1',

    /**
     * Sends or replaces an invitation for a pending admin.
     */
    INVITE = 'admin.invite.queue.v1',

    /**
     * Notifies an admin after refresh-token reuse revokes all sessions.
     */
    REFRESH_REUSE_NOTICE = 'admin.refresh-reuse-notice.queue.v1',

    /**
     * Reconciles the persisted session version with the session store.
     */
    SESSION_RECONCILE = 'admin.session-reconcile.queue.v1',
}
