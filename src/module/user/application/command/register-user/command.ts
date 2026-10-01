/**
 * @file command.ts
 * @description Defines the RegisterUserCommand for self-service user registration.
 */

import { Command } from '@nestjs/cqrs';
import type { AvatarUploadDescriptor } from 'src/shared/domain/avatar';

/**
 * Command to register a pending user account on their own behalf.
 */
export class RegisterUserCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param email The email address of the new user
     * @param name The name of the new user
     * @param password The plain-text password for the new user
     * @param avatar File descriptor bound to the registration proof
     * @param uploadToken Proof authorizing this form and its pending avatar
     */
    constructor(
        readonly email: string,
        readonly name: string,
        readonly password: string,
        readonly avatar: AvatarUploadDescriptor,
        readonly uploadToken: string,
    ) {
        super();
    }
}
