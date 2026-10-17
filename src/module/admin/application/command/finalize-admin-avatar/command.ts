/**
 * @file command.ts
 * @description Defines the command for finalizing an admin's initial activation avatar.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Reconciles copy, attachment, and cleanup from authoritative account state.
 */
export class FinalizeAdminAvatarCommand extends Command<void> {
    /**
     * Initializes the durable avatar identity retained across retries.
     *
     * @param id Account referenced by the job
     * @param deliveryId Accepted invitation identity used as the immutable avatar version
     */
    constructor(
        readonly id: string,
        readonly deliveryId: string,
    ) {
        super();
    }
}
