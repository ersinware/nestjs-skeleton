/**
 * @file command.ts
 * @description Confirms an admin email change with a verified session and emailed proof.
 */

import { Command } from '@nestjs/cqrs';
import type { IdempotencyRequest } from 'src/core/idempotency';

/**
 * Completes a pending email change for the authenticated admin.
 */
export class ConfirmAdminEmailChangeCommand extends Command<void> {
    /**
     * Initializes the authenticated confirmation.
     *
     * @param idempotencyRequest Logical request identity and canonical semantic input.
     * @param id Account identifier from the verified principal
     * @param token Confirmation token received at the new address
     */
    constructor(
        readonly idempotencyRequest: IdempotencyRequest,
        readonly id: string,
        readonly token: string,
    ) {
        super();
    }
}
