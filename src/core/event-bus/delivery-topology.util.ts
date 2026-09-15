/**
 * @file delivery-topology.util.ts
 * @description Extracts a queue inventory from producer-owned event routes.
 */

import type { DeliveryRoutes } from 'src/core/event-bus/delivery-routes.type';
import type { JobQueueDefinition } from 'src/core/job-queue';

/**
 * Uses the same targets for event acceptance and queue provisioning.
 *
 * @param routes Producer schema and event targets
 * @returns Vendor-independent source queue inventory
 */
export function createDeliveryTopology(routes: DeliveryRoutes): JobQueueDefinition {
    return {
        schema: routes.schema,
        queues: [...new Set(Object.values(routes.events).flat())],
    };
}
