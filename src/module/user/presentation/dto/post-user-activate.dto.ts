/**
 * @file post-user-activate.dto.ts
 * @description Request schema for activating a pending user account.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsJwtToken, IsStrongPassword } from 'src/core/http';

/**
 * Activation token and existing account password supplied by the owner.
 */
@ApiSchema({ name: 'PostUserActivate', description: 'Input validation schema for user account activation.' })
export class PostUserActivateDto {
    /**
     * The activation token delivered to the account email address.
     */
    @IsJwtToken('The activation token')
    readonly token!: string;

    /**
     * The existing plain-text password, checked against the stored hash.
     */
    @IsStrongPassword()
    readonly password!: string;
}
