/**
 * @file command.ts
 * @description Command that activates a pending user account with emailed proof and its existing password.
 */

import { Command } from '@nestjs/cqrs';
import { SessionOutcome } from 'src/core/security/session';

/**
 * Activates a pending user account and then attempts to open its first session.
 */
export class ActivateUserCommand extends Command<ActivateUserResult> {
    /**
     * Initializes the activation proof.
     *
     * @param token Activation token received at the account email address
     * @param password The account's existing plain-text password
     */
    constructor(
        readonly token: string,
        readonly password: string,
    ) {
        super();
    }
}

/**
 * A committed activation with a new session or a required sign-in.
 */
export type ActivateUserResult =
    | {
          /**
           * Confirms that a session was opened after activation.
           */
          readonly session: SessionOutcome.CREATED;

          /**
           * Access token issued for the new session.
           */
          readonly accessToken: string;

          /**
           * Refresh token issued for the new session.
           */
          readonly refreshToken: string;
      }
    | {
          /**
           * Activation committed, but the client must sign in.
           */
          readonly session: SessionOutcome.LOGIN_REQUIRED;
      };
