/**
 * @file user-delivery.constant.ts
 * @description Versioned user event routes to stable consumer queues.
 */

import { defineDeliveryRoutes } from 'src/core/event-bus';
import { UserEvent } from 'src/module/user/domain/event/user-event.enum';

/**
 * Stable queue names owned by this producer.
 */
const USER_DELIVERY_QUEUES = {
    USER_CACHE_INVALIDATE: 'user.cache.invalidate',
    USER_SESSION_RECONCILE: 'user.session.reconcile',
    USER_SESSION_REVOCATION_EMAIL_SEND: 'user.security-notice.send',
} as const;

/**
 * Durable targets owned by this producer; notification follow-up events are added with their use cases.
 */
export const USER_DELIVERY_ROUTES = defineDeliveryRoutes({
    schema: 'user_delivery',
    events: {
        [UserEvent.UPDATED]: [USER_DELIVERY_QUEUES.USER_CACHE_INVALIDATE],
        [UserEvent.UNBANNED]: [USER_DELIVERY_QUEUES.USER_CACHE_INVALIDATE],
        [UserEvent.BANNED]: [USER_DELIVERY_QUEUES.USER_CACHE_INVALIDATE, USER_DELIVERY_QUEUES.USER_SESSION_RECONCILE],
        [UserEvent.DELETED]: [USER_DELIVERY_QUEUES.USER_CACHE_INVALIDATE, USER_DELIVERY_QUEUES.USER_SESSION_RECONCILE],
        [UserEvent.PERMISSIONS_CHANGED]: [
            USER_DELIVERY_QUEUES.USER_CACHE_INVALIDATE,
            USER_DELIVERY_QUEUES.USER_SESSION_RECONCILE,
        ],
        [UserEvent.PASSWORD_CHANGED]: [USER_DELIVERY_QUEUES.USER_SESSION_RECONCILE],
        [UserEvent.SESSIONS_REVOKED]: [USER_DELIVERY_QUEUES.USER_SESSION_RECONCILE],
    } satisfies Record<UserEvent, readonly [string, ...string[]]>,
});
