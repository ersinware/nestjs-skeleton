/**
 * @file command.ts
 * @description Confirms a user email change with a verified session and emailed proof.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import type { IdempotencyRequest } from 'src/core/idempotency';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';

/**
 * Completes a pending email change for the authenticated user.
 */
export class ConfirmUserEmailChangeCommand extends Command<void> implements ICacheInvalidatingCommand {
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

    /**
     * Identifies the user projection to evict after successful dispatch.
     *
     * @returns Cached user projection to evict after confirmation
     */
    invalidatedKeys(): readonly string[] {
        return [CacheKeys.userById(this.id)];
    }
}
