/**
 * @file command.ts
 * @description Command that activates a pending admin account.
 */

import { Command } from '@nestjs/cqrs';
import type { IdempotencyRequest } from 'src/core/idempotency';
import type { AvatarUploadDescriptor } from 'src/shared/domain/avatar';

/**
 * Activates a pending admin account: verifies the invite token and sets the first password, which
 * also kills every outstanding invite link.
 */
export class ActivateAdminCommand extends Command<void> {
    /**
     * Initializes the command with its payload.
     *
     * @param idempotencyRequest Validated client key and canonical endpoint semantics
     * @param token The invite token from the invitation email
     * @param password The plain-text initial password chosen by the owner
     * @param avatar Required descriptor bound to the uploaded object
     * @param uploadToken Form-bound upload proof returned by initiation
     */
    constructor(
        readonly idempotencyRequest: IdempotencyRequest,
        readonly token: string,
        readonly password: string,
        readonly avatar: AvatarUploadDescriptor,
        readonly uploadToken: string,
    ) {
        super();
    }
}
