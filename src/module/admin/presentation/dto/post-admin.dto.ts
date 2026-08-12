/**
 * @file post-admin.dto.ts
 * @description Request schema for creating a new admin account.
 */

import { ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsEmailAddress, IsPersonName, IsStrongPassword } from 'src/core/http';

/**
 * Admin-creation payload. The composed decorators enforce email format, name shape, and password
 * strength in one place each.
 */
@Exclude()
@ApiSchema({ name: 'PostAdmin', description: 'Input validation schema for admin account creation.' })
export class PostAdminDto {
    /**
     * The unique email address to associate with the new account.
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

    /**
     * The plain-text password, hashed before persistence.
     */
    @Expose()
    @IsStrongPassword()
    readonly password!: string;
}
