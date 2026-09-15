/**
 * @file auth-delivery.constant.ts
 * @description Versioned auth event routes to stable consumer queues.
 */

import { defineDeliveryRoutes } from 'src/core/event-bus';
import { AdminIntegrationEvent } from 'src/shared/domain/admin';
import { UserIntegrationEvent } from 'src/shared/domain/user';

/**
 * Stable queue names owned by this producer.
 */
const AUTH_DELIVERY_QUEUES = {
    USER_SESSION_REVOKE: 'user.session.revoke',
    ADMIN_SESSION_REVOKE: 'admin.session.revoke',
} as const;

/**
 * Durable targets owned by this producer; notification follow-up events are added with their use cases.
 */
export const AUTH_DELIVERY_ROUTES = defineDeliveryRoutes({
    schema: 'auth_delivery',
    events: {
        [UserIntegrationEvent.REFRESH_REUSE_DETECTED]: [AUTH_DELIVERY_QUEUES.USER_SESSION_REVOKE],
        [UserIntegrationEvent.LOGOUT_ALL_REQUESTED]: [AUTH_DELIVERY_QUEUES.USER_SESSION_REVOKE],
        [AdminIntegrationEvent.REFRESH_REUSE_DETECTED]: [AUTH_DELIVERY_QUEUES.ADMIN_SESSION_REVOKE],
        [AdminIntegrationEvent.LOGOUT_ALL_REQUESTED]: [AUTH_DELIVERY_QUEUES.ADMIN_SESSION_REVOKE],
    } satisfies Record<UserIntegrationEvent | AdminIntegrationEvent, readonly [string, ...string[]]>,
});
