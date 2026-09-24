/**
 * @file post-admin-email-confirm.dto.ts
 * @description Request schema for confirming an authenticated admin email change.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsJwtToken } from 'src/core/http';

/**
 * Emailed proof to consume for the account identified by the authenticated session.
 */
@ApiSchema({ name: 'PostAdminEmailConfirm', description: 'Confirm the current admin email change request.' })
export class PostAdminEmailConfirmDto {
    /**
     * The confirmation token delivered to the pending address.
     */
    @IsJwtToken('The email confirmation token')
    readonly token!: string;
}
