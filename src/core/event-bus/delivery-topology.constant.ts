/**
 * @file delivery-topology.constant.ts
 * @description Producer-owned delivery schemas and their stable consumer queues.
 */

import type { Queue } from 'pg-boss';

/**
 * Technical routing inventory; event-to-consumer acceptance is configured separately.
 */
const DELIVERY_CONSUMERS = {
    user_delivery: ['user.cache.invalidate', 'user.session.reconcile', 'user.security-notice.send'],
    admin_delivery: ['admin.session.reconcile', 'admin.invite.send', 'admin.security-notice.send'],
    auth_delivery: ['user.session.revoke', 'admin.session.revoke'],
} as const;

/**
 * Builds DLQs before their source queues so provisioning can respect the dependency.
 */
export const DELIVERY_TOPOLOGY: readonly {
    readonly schema: string;
    readonly queues: readonly Readonly<Queue>[];
}[] = Object.entries(DELIVERY_CONSUMERS).map(([schema, consumers]) => {
    const queues = consumers.map((name) => ({ name, deadLetter: `${name}.dlq` }));

    return {
        schema,
        queues: [
            ...queues.map(({ deadLetter }) => ({ name: deadLetter })),
            ...queues.map(({ name, deadLetter }) => ({ name, deadLetter })),
        ].map(
            (queue): Queue => ({
                ...queue,
                policy: 'standard',
                partition: false,
                notify: false,
                retentionSeconds: 2592000,
                deleteAfterSeconds: 2592000,
            }),
        ),
    };
});
