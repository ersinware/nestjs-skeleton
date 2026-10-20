/**
 * @file command.ts
 * @description Defines the command for completing a user's profile avatar replacement.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';

/**
 * Reconciles copy, attachment, and cleanup from authoritative account state.
 */
export class ReplaceUserAvatarCommand extends Command<void> implements ICacheInvalidatingCommand {
    /**
     * Initializes the durable avatar identity retained across retries.
     *
     * @param id Account referenced by the job
     * @param deliveryId Profile upload identity used as the immutable avatar version
     * @param previousAvatarId Previous avatar identity captured when the profile change was accepted
     */
    constructor(
        readonly id: string,
        readonly deliveryId: string,
        readonly previousAvatarId: string,
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
