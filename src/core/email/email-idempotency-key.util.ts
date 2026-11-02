/**
 * @file email-idempotency-key.util.ts
 * @description Builds the provider identity for one logical queued email delivery.
 */

import type { EmailDeliveryIdentity } from 'src/core/email/port/emailer.port';

/**
 * Keeps every retry and redrive of one logical delivery on the same provider identity.
 *
 * @param delivery The owning queue and stable delivery identity
 * @returns Queue-scoped logical delivery key
 */
export function buildEmailIdempotencyKey(delivery: EmailDeliveryIdentity): string {
    return `${delivery.queueName}/${delivery.deliveryId}`;
}
