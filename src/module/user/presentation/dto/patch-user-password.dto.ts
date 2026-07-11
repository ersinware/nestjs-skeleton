/**
 * @file patch-user-password.dto.ts
 * @description Defines the input validation schema for changing a user's password securely.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsStrongPassword } from 'src/core/http';

/**
 * The payload required to securely update a user's password.
 * Validates both the current and new passwords to ensure strength and authorize the change.
 */
@ApiSchema({ name: 'PatchUserPassword', description: 'Schema for changing user password' })
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
