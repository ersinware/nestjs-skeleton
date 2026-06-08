/**
 * @file patch-user-password.dto.ts
 * @description Data transfer object defining the structure of a request to update user password.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsStrongPassword } from 'src/common/decorator/validator/password.decorator';

/**
 * DTO containing current and new password payloads to update credentials.
 */
@ApiSchema({ name: 'PatchUserPassword', description: 'Schema for changing user password' })
export class PatchUserPasswordDto {
    /**
     * The user's current password.
     */
    @IsStrongPassword('The current password')
    readonly currentPassword!: string;

    /**
     * The user's new strong password.
     */
    @IsStrongPassword('The new password')
    readonly newPassword!: string;
}
