/**
 * @file command.ts
 * @description Defines the command for completing an admin's profile avatar replacement.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Reconciles copy, attachment, and cleanup from authoritative account state.
 */
export class ReplaceAdminAvatarCommand extends Command<void> {
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
}
