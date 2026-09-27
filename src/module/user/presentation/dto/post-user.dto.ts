/**
 * @file post-user.dto.ts
 * @description Request schema for registering a new user.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsEmailAddress, IsPersonName, IsStrongPassword } from 'src/core/http';

/**
 * Registration payload for a pending account. The composed decorators enforce email format,
 * name shape, and password strength in one place each.
 */
@ApiSchema({ name: 'PostUser', description: 'Input for creating a pending user account.' })
export class PostUserDto {
    /**
     * The unique email address to associate with the new account.
     */
    @IsEmailAddress()
    readonly email!: string;

    /**
     * The full real name or display name of the user.
     */
    @IsPersonName()
    readonly name!: string;

    /**
     * The password chosen at registration, hashed before persistence and required for activation.
     */
    @IsStrongPassword()
    readonly password!: string;
}
