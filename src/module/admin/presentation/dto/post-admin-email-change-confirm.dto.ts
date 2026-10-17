/**
 * @file post-admin-email-change-confirm.dto.ts
 * @description Request schema for confirming an authenticated admin email change.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsJwtToken } from 'src/core/http';

/**
 * Emailed proof to consume for the account identified by the authenticated session.
 */
@ApiSchema({ name: 'PostAdminEmailChangeConfirm', description: 'Confirm the current admin email change request.' })
export class PostAdminEmailChangeConfirmDto {
    /**
     * The confirmation token delivered to the pending address.
     */
    @IsJwtToken('The email confirmation token')
    readonly token!: string;
}
