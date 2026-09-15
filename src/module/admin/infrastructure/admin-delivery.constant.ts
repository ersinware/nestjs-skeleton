/**
 * @file admin-delivery.constant.ts
 * @description Versioned admin event routes to stable consumer queues.
 */

import { defineDeliveryRoutes } from 'src/core/event-bus';
import { AdminEvent } from 'src/module/admin/domain/event/admin-event.enum';

/**
 * Stable queue names owned by this producer.
 */
const ADMIN_DELIVERY_QUEUES = {
    ADMIN_INVITE_SEND: 'admin.invite.send',
    ADMIN_SESSION_RECONCILE: 'admin.session.reconcile',
    ADMIN_SESSION_REVOCATION_EMAIL_SEND: 'admin.security-notice.send',
} as const;

/**
 * Durable targets owned by this producer; notification follow-up events are added with their use cases.
 */
export const ADMIN_DELIVERY_ROUTES = defineDeliveryRoutes({
    schema: 'admin_delivery',
    events: {
        [AdminEvent.INVITED]: [ADMIN_DELIVERY_QUEUES.ADMIN_INVITE_SEND],
        [AdminEvent.BANNED]: [ADMIN_DELIVERY_QUEUES.ADMIN_SESSION_RECONCILE],
        [AdminEvent.DELETED]: [ADMIN_DELIVERY_QUEUES.ADMIN_SESSION_RECONCILE],
        [AdminEvent.PERMISSIONS_CHANGED]: [ADMIN_DELIVERY_QUEUES.ADMIN_SESSION_RECONCILE],
        [AdminEvent.PASSWORD_CHANGED]: [ADMIN_DELIVERY_QUEUES.ADMIN_SESSION_RECONCILE],
        [AdminEvent.SESSIONS_REVOKED]: [ADMIN_DELIVERY_QUEUES.ADMIN_SESSION_RECONCILE],
    } satisfies Record<AdminEvent, readonly [string, ...string[]]>,
});
