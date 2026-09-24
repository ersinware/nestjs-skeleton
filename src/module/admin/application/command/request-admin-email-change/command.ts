/**
 * @file command.ts
 * @description Requests an email change after current-password verification.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Requests a new confirmation link for the authenticated admin.
 */
export class RequestAdminEmailChangeCommand extends Command<void> {
    /**
     * Initializes the self-service request.
     *
     * @param id Account identifier from the verified principal
     * @param newEmail Validated and normalized target address
     * @param password Unmodified current password supplied by the caller
     */
    constructor(
        readonly id: string,
        readonly newEmail: string,
        readonly password: string,
    ) {
        super();
    }
}
