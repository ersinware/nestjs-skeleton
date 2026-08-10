/**
 * @file patch-user-password.dto.ts
 * @description Request schema for changing a user's password.
 */

import { ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsStrongPassword } from 'src/core/http';

/**
 * Password-change payload: the current password authorizes the change, the new one replaces it.
 */
@Exclude()
@ApiSchema({ name: 'PatchUserPassword', description: 'Schema for changing user password' })
export class PatchUserPasswordDto {
    /**
     * The current plain-text password to authorize the change.
     */
    @Expose()
    @IsStrongPassword('The current password')
    readonly currentPassword!: string;

    /**
     * The new strong password to replace the current one.
     */
    @Expose()
    @IsStrongPassword('The new password')
    readonly newPassword!: string;
}
