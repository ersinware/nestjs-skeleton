/**
 * @file patch-admin-status.dto.ts
 * @description Defines the input validation schema for administrative account status updates. It ensures that only valid boolean states are passed to the controller when suspending or activating an admin.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';

/**
 * DTO for validating admin status update action requests.
 * Enforces strict typing and presence checks on the status payload.
 */
@ApiSchema({
    name: 'PatchAdminStatus',
    description: 'Input validation schema for administrative admin account status updates',
})
export class PatchAdminStatusDto {
    /**
     * Target active state, false to suspend/ban, true to activate/unban.
     * Determines whether the admin is allowed to authenticate and access the system.
     */
    @IsBoolean()
    @IsNotEmpty()
    @ApiProperty({
        type: 'boolean',
        description: 'True to activate/unban the account, false to suspend/ban the account.',
        example: true,
    })
    readonly active!: boolean;
}
