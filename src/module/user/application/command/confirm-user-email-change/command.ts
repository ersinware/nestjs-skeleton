/**
 * @file command.ts
 * @description Confirms a user email change with a verified session and emailed proof.
 */

import { Command } from '@nestjs/cqrs';
import type { ICacheInvalidatingCommand } from 'src/core/cqrs';
import { SessionOutcome } from 'src/core/security/session';
import { CacheKeys } from 'src/module/user/application/user-cache-key.util';

/**
 * Completes a pending email change for the authenticated user.
 */
export class ConfirmUserEmailChangeCommand
    extends Command<ConfirmUserEmailChangeResult>
    implements ICacheInvalidatingCommand
{
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

    /**
     * Identifies the user projection to evict after successful dispatch.
     *
     * @returns Cached user projection to evict after confirmation
     */
    invalidatedKeys(): readonly string[] {
        return [CacheKeys.userById(this.id)];
    }
}

/**
 * A committed email change with a replacement session or required sign-in.
 */
export type ConfirmUserEmailChangeResult =
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
