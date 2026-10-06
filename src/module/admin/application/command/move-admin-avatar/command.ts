/**
 * @file command.ts
 * @description Defines the owner command for moving an activated admin's initial avatar.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Reconciles copy, attachment, and cleanup from authoritative account state.
 */
export class MoveAdminAvatarCommand extends Command<void> {
    /**
     * Initializes the durable invitation identity retained across retries.
     *
     * @param id Account referenced by the job
     * @param deliveryId Consumed invitation identity used as the avatar version
     */
    constructor(
        readonly id: string,
        readonly deliveryId: string,
    ) {
        super();
    }
}
