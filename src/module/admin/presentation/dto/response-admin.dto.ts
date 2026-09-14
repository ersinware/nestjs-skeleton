/**
 * @file response-admin.dto.ts
 * @description Response schema for admin records.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsEmailAddress, IsEntityId, IsPermissionList, IsPersonName } from 'src/core/http';
import type { Permission } from 'src/shared/domain/principal';

/**
 * Whitelist-exposes the client-safe admin fields; anything not exposed here — the password hash in
 * particular — can never reach a client.
 */
@Exclude()
@ApiSchema({ name: 'ResponseAdmin', description: 'Standard admin response schema.' })
export class ResponseAdminDto {
    /**
     * The unique identifier of the admin, used to address follow-up operations.
     */
    @Expose()
    @IsEntityId('The admin ID')
    readonly id!: string;

    /**
     * The email address of the admin.
     */
    @Expose()
    @IsEmailAddress({ normalize: false })
    readonly email!: string;

    /**
     * The full name of the admin.
     */
    @Expose()
    @IsPersonName({ normalize: false })
    readonly name!: string;

    /**
     * The permissions the admin holds, so the back office can show and edit their authority.
     */
    @Expose()
    @IsPermissionList('The permissions the admin holds')
    readonly permissions!: readonly Permission[];

    /**
     * Whether the account is currently banned, so the back office can offer the matching
     * ban/unban action.
     */
    @Expose()
    @ApiProperty({
        type: Boolean,
        description: 'Whether the admin account is currently banned',
        example: false,
    })
    readonly isBanned!: boolean;
}
