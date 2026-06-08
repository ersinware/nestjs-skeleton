/**
 * @file post-auth-login.dto.ts
 * @description Input validation DTO for authentication login requests.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsUserEmail } from 'src/common/decorator/validator/email.decorator';
import { IsStrongPassword } from 'src/common/decorator/validator/password.decorator';

/**
 * DTO for validating user/admin credentials during authentication login.
 */
@ApiSchema({ name: 'PostAuthLogin', description: 'Input validation schema for user or admin login credentials' })
export class PostAuthLoginDto {
    /**
     * Unique email address associated with the user or admin account.
     */
    @IsUserEmail('The email address')
    readonly email!: string;

    /**
     * Cleartext password associated with the account.
     */
    @IsStrongPassword('The password')
    readonly password!: string;
}
