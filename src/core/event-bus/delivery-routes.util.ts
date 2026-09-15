/**
 * @file delivery-routes.util.ts
 * @description Validates producer-owned routes when their catalogs are defined.
 */

import type { DeliveryRoutes } from 'src/core/event-bus/delivery-routes.type';
import { SystemException } from 'src/shared/exception';

/**
 * Rejects duplicate targets within an event while preserving the catalog's inferred type.
 *
 * @param routes Producer schema and event targets
 * @returns The validated routing catalog
 * @throws {SystemException} If an event targets the same queue more than once.
 */
export function defineDeliveryRoutes<const T extends DeliveryRoutes>(routes: T): T {
    for (const [eventType, targets] of Object.entries(routes.events)) {
        if (new Set(targets).size !== targets.length) {
            throw new SystemException(`Invalid delivery route: ${routes.schema}.${eventType}.`);
        }
    }

    return routes;
}
