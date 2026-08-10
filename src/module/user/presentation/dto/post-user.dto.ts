/**
 * @file post-user.dto.ts
 * @description Request schema for registering a new user.
 */

import { ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsEmailAddress, IsPersonName, IsStrongPassword } from 'src/core/http';

/**
 * Registration payload. The composed decorators enforce email format, name shape, and password
 * strength in one place each.
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
     * The plain-text password, hashed before persistence.
     */
    @Expose()
    @IsStrongPassword()
    readonly password!: string;
}
