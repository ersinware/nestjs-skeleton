/**
 * @file command.ts
 * @description Defines the command to terminate a specific session for a given user or admin.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to log out a user or admin from the current device.
 */
export class LogoutCommand extends Command<void> {
    constructor(readonly refreshToken: string) {
        super();
    }
}
