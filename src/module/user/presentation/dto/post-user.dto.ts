/**
 * @file post-user.dto.ts
 * @description Defines the validation schema for registering a new user in the system.
 */

import { ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsEmailAddress, IsPersonName, IsStrongPassword } from 'src/core/http';

/**
 * The payload containing all necessary information to create a new user account.
 * Enforces strict formatting on emails and password strength requirements.
 */
@Exclude()
@ApiSchema({ name: 'PostUser', description: 'Input validation schema for user registration and creation.' })
export class PostUserDto {
    /**
     * The unique email address to associate with the new account.
     */
    @Expose()
    @IsEmailAddress()
    readonly email!: string;

    /**
     * The full real name or display name of the user.
     */
    @Expose()
    @IsPersonName()
    readonly name!: string;

    /**
     * The plain-text password that will be securely hashed upon creation.
     */
    @Expose()
    @IsStrongPassword()
    readonly password!: string;
}
