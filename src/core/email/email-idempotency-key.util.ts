/**
 * @file email-idempotency-key.util.ts
 * @description Builds a delivery-scoped key for identical outgoing email requests.
 */

import { createHash } from 'node:crypto';
import type { EmailDeliveryIdentity, EmailPayload } from 'src/core/email/port/emailer.port';

/**
 * Keeps retries of the same email request on one key while treating changed content as a new send.
 * The sender is included because it is part of the provider request but not the email payload.
 *
 * @param data The recipient, subject, and HTML body sent to the provider
 * @param delivery The owning queue and stable delivery identity
 * @param from The configured sender address used for this request
 * @returns A queue-scoped key for the exact outgoing email
 */
export function buildEmailIdempotencyKey(data: EmailPayload, delivery: EmailDeliveryIdentity, from: string): string {
    const contentHash = createHash('sha256')
        .update(JSON.stringify({ from, to: data.to, subject: data.subject, html: data.body }))
        .digest('hex');

    return `${delivery.queueName}/${delivery.deliveryId}/${contentHash}`;
}
