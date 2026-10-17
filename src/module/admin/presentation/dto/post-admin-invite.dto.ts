/**
 * @file post-admin-invite.dto.ts
 * @description Request schema for inviting a new admin.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsEmailAddress, IsPersonName } from 'src/core/http';

/**
 * Admin invitation payload. Carries no password: the account is created pending activation and its
 * owner chooses the password through the emailed invitation, so no human ever handles a credential.
 */
@ApiSchema({ name: 'PostAdminInvite', description: 'Input validation schema for inviting a new admin.' })
export class PostAdminInviteDto {
    /**
     * The unique email address the activation invitation is sent to.
     */
    @IsEmailAddress()
    readonly email!: string;

    /**
     * The full real name or display name of the admin.
     */
    @IsPersonName()
    readonly name!: string;
}
