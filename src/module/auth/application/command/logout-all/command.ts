/**
 * @file command.ts
 * @description Defines the command to terminate all active sessions for a given user or admin.
 */

import { AuthRole } from 'src/core/security';

import { Command } from '@nestjs/cqrs';

/**
 * Command to log out a user or admin from all devices.
 */
export class LogoutAllCommand extends Command<void> {
    constructor(
        readonly role: AuthRole,
        readonly sub: string,
    ) {
        super();
    }
}
