/**
 * @file post-admin-activate.dto.ts
 * @description Request schema for activating a pending admin account.
 */

import { ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsJwtToken, IsStrongPassword } from 'src/core/http';

/**
 * Activation payload: the invite token proves the invitation, the password becomes the account's
 * first credential.
 */
@Exclude()
@ApiSchema({ name: 'PostAdminActivate', description: 'Input validation schema for admin account activation.' })
export class PostAdminActivateDto {
    /**
     * The invite token from the invitation email.
     */
    @Expose()
    @IsJwtToken('The invite token')
    readonly token!: string;

    /**
     * The plain-text initial password, hashed before persistence.
     */
    @Expose()
    @IsStrongPassword()
    readonly password!: string;
}
