/**
 * @file patch-user-status.dto.ts
 * @description Input validation DTO for administrative user account status updates.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';

/**
 * DTO for validating user status update action requests.
 */
@ApiSchema({
    name: 'PatchUserStatus',
    description: 'Input validation schema for administrative user account status updates',
})
export class PatchUserStatusDto {
    /**
     * Target active state (false to suspend/ban, true to activate/unban).
     */
    @IsBoolean()
    @IsNotEmpty()
    @ApiProperty({
        description: 'True to activate/unban the account, false to suspend/ban the account.',
        example: true,
    })
    readonly active!: boolean;
}
