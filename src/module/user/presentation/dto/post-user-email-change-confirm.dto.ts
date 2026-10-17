/**
 * @file post-user-email-change-confirm.dto.ts
 * @description Request schema for confirming an authenticated user email change.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsJwtToken } from 'src/core/http';

/**
 * Emailed proof to consume for the account identified by the authenticated session.
 */
@ApiSchema({ name: 'PostUserEmailChangeConfirm', description: 'Confirm the current user email change request.' })
export class PostUserEmailChangeConfirmDto {
    /**
     * The confirmation token delivered to the pending address.
     */
    @IsJwtToken('The email confirmation token')
    readonly token!: string;
}
