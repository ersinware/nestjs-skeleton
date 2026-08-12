/**
 * @file post-admin.dto.ts
 * @description Request schema for creating a new admin account.
 */

import { ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsEmailAddress, IsPersonName } from 'src/core/http';

/**
 * Admin-creation payload. Carries no password: the account is created pending activation and its
 * owner chooses the password through the emailed invitation, so no human ever handles a credential.
 */
@Exclude()
@ApiSchema({ name: 'PostAdmin', description: 'Input validation schema for admin account creation.' })
export class PostAdminDto {
    /**
     * The unique email address the activation invitation is sent to.
     */
    @Expose()
    @IsEmailAddress()
    readonly email!: string;

    /**
     * The full real name or display name of the admin.
     */
    @Expose()
    @IsPersonName()
    readonly name!: string;
}
