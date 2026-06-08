/**
 * @file post-user.dto.ts
 * @description Input validation DTO for creating a new user account.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsUserEmail } from 'src/common/decorator/validator/email.decorator';
import { IsUserName } from 'src/common/decorator/validator/name.decorator';
import { IsStrongPassword } from 'src/common/decorator/validator/password.decorator';

/**
 * DTO for validating new user account details.
 */
@ApiSchema({ name: 'PostUser', description: 'Input validation schema for user registration and creation.' })
export class PostUserDto {
    /**
     * Unique email address for the new user account.
     */
    @IsUserEmail('The email address')
    readonly email!: string;

    /**
     * The full name of the user.
     */
    @IsUserName('The full name')
    readonly name!: string;

    /**
     * Cleartext password for securing the account.
     */
    @IsStrongPassword('The password')
    readonly password!: string;
}
