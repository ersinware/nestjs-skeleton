/**
 * @file command.ts
 * @description Defines the command to terminate all active sessions for a given user or admin.
 */

import { Command } from '@nestjs/cqrs';
import type { PrincipalType } from 'src/shared/domain/principal';

/**
 * Command to log out a user or admin from all devices.
 */
export class LogoutAllCommand extends Command<void> {
    /**
     * Initializes the command payload.
     *
     * @param id The principal identifier whose sessions are all terminated
     * @param principalType The kind of principal, which selects the module that owns its session counters
     */
    constructor(
        readonly id: string,
        readonly principalType: PrincipalType,
    ) {
        super();
    }
}
