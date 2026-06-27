/**
 * @file post-user.dto.ts
 * @description Defines the validation schema for registering a new user in the system.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsUserEmail } from 'src/common/validation/decorator/email.decorator';
import { IsUserName } from 'src/common/validation/decorator/name.decorator';
import { IsStrongPassword } from 'src/common/validation/decorator/password.decorator';

/**
 * The payload containing all necessary information to create a new user account.
 * Enforces strict formatting on emails and password strength requirements.
 */
@ApiSchema({ name: 'PostUser', description: 'Input validation schema for user registration and creation.' })
export class PostUserDto {
    /**
     * The unique email address to associate with the new account.
     */
    @IsUserEmail('The email address')
    readonly email!: string;

    /**
     * The full real name or display name of the user.
     */
    @IsUserName('The full name')
    readonly name!: string;

    /**
     * The plain-text password that will be securely hashed upon creation.
     */
    @IsStrongPassword('The password')
    readonly password!: string;
}
