/**
 * @file command.ts
 * @description Defines the ChangeAdminPasswordCommand for changing an admin's password.
 */

import { Command } from '@nestjs/cqrs';

/**
 * Command to change an existing admin's password.
 */
export class ChangeAdminPasswordCommand extends Command<ChangeAdminPasswordResult> {
    /**
     * Initializes the command payload.
     *
     * @param id The unique identifier of the admin
     * @param currentPassword The admin's current password
     * @param newPassword The new password to set
     */
    constructor(
        readonly id: string,
        readonly currentPassword: string,
        readonly newPassword: string,
    ) {
        super();
    }
}

/**
 * A committed password change with either a fresh session or a required sign-in.
 */
export type ChangeAdminPasswordResult =
    | {
          /**
           * Confirms that a replacement session was opened after the password change.
           */
          readonly session: 'created';

          /**
           * Access token issued for the replacement session.
           */
          readonly accessToken: string;

          /**
           * Refresh token issued for the replacement session.
           */
          readonly refreshToken: string;
      }
    | {
          /**
           * The password change committed, but the client must sign in again.
           */
          readonly session: 'login_required';
      };
