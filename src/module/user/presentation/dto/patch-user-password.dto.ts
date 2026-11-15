/**
 * @file patch-user-password.dto.ts
 * @description Request schema for changing a user's password.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsStrongPassword } from 'src/core/http';

/**
 * Password-change payload: the current password authorizes the change, the new one replaces it.
 */
@ApiSchema({ name: 'PatchUserPassword', description: 'Current and new user passwords.' })
export class PatchUserPasswordDto {
    /**
     * The current plain-text password to authorize the change.
     */
    @IsStrongPassword('The current password')
    readonly currentPassword!: string;

    /**
     * The new strong password to replace the current one.
     */
    @IsStrongPassword('The new password')
    readonly newPassword!: string;
}
