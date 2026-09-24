/**
 * @file post-login.dto.ts
 * @description Request DTO carrying the credentials of a user or admin login.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsEmailAddress, IsStrongPassword } from 'src/core/http';

/**
 * Validates login credentials at the transport boundary; shared by the user and admin login routes,
 * which accept the identical payload.
 */
@ApiSchema({ name: 'PostLogin', description: 'Input validation schema for user or admin login credentials' })
export class PostLoginDto {
    /**
     * The email address identifying the account.
     */
    @IsEmailAddress()
    readonly email!: string;

    /**
     * The plain-text password to verify against the stored hash.
     */
    @IsStrongPassword()
    readonly password!: string;
}
