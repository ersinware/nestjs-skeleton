/**
 * @file command.ts
 * @description Defines the owner command for finalizing a registered user's initial avatar.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';

/**
 * Reconciles copy, attachment, and cleanup from authoritative account state.
 */
export class FinalizeUserAvatarCommand extends Command<void> implements ICacheInvalidatingCommand {
    /**
     * Initializes the durable work identity.
     *
     * @param id Account referenced by the job
     * @param deliveryId Stable delivery identity used as the permanent avatar version
     */
    constructor(
        readonly id: string,
        readonly deliveryId: string,
    ) {
        super();
    }

    /**
     * Evicts the same projection used by durable aggregate cache jobs.
     *
     * @returns Cache keys invalidated after successful reconciliation
     */
    invalidatedKeys(): readonly string[] {
        return [CacheKeys.userById(this.id)];
    }
}
