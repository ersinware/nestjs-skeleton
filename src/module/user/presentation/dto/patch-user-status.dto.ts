/**
 * @file patch-user-status.dto.ts
 * @description Defines the validation schema used by administrators to suspend or unsuspend user accounts.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty } from 'class-validator';

/**
 * The payload required to modify a user's active status.
 */
@ApiSchema({
    name: 'PatchUserStatus',
    description: 'Input validation schema for administrative user account status updates',
})
export class PatchUserStatusDto {
    /**
     * The target operational state of the user.
     * True allows access, false instantly revokes access and bans the identifier.
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
