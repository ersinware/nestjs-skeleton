/**
 * @file command.ts
 * @description Confirms an admin email change with a verified session and emailed proof.
 */

import { Command } from '@nestjs/cqrs';
import { SessionOutcome } from 'src/core/security/session';

/**
 * Completes a pending email change for the authenticated admin.
 */
export class ConfirmAdminEmailChangeCommand extends Command<ConfirmAdminEmailChangeResult> {
    /**
     * Initializes the authenticated confirmation.
     *
     * @param id Account identifier from the verified principal
     * @param token Confirmation token received at the new address
     */
    constructor(
        readonly id: string,
        readonly token: string,
    ) {
        super();
    }
}

/**
 * A committed email change with a replacement session or required sign-in.
 */
export type ConfirmAdminEmailChangeResult =
    | {
          /**
           * Confirms that a replacement session was opened after the email change.
           */
          readonly session: SessionOutcome.CREATED;

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
           * The email change committed, but the client must sign in again.
           */
          readonly session: SessionOutcome.LOGIN_REQUIRED;
      };
