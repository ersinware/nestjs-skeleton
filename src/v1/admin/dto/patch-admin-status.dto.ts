/**
 * @file patch-admin-status.dto.ts
 * @description Input validation DTO for administrative admin account status updates.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';

/**
 * DTO for validating admin status update action requests.
 */
@ApiSchema({
    name: 'PatchAdminStatus',
    description: 'Input validation schema for administrative admin account status updates',
})
export class PatchAdminStatusDto {
    /**
     * Target active state, false to suspend/ban, true to activate/unban.
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
