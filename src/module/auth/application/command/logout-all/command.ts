/**
 * @file command.ts
 * @description Defines the command to terminate all active sessions for a given user or admin.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to log out a user or admin from all devices.
 */
export class LogoutAllCommand extends Command<void> {
    constructor(readonly sub: string) {
        super();
    }
}
