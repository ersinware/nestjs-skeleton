/**
 * @file response-admin.dto.ts
 * @description Response schema for admin records.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsEmailAddress, IsEntityId, IsPersonName } from 'src/core/http';
import { AdminRole } from 'src/shared/domain/admin';

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
    @IsEmailAddress()
    readonly email!: string;

    /**
     * The full name of the admin.
     */
    @Expose()
    @IsPersonName()
    readonly name!: string;

    /**
     * The authorization role of the admin.
     */
    @Expose()
    @ApiProperty({
        type: String,
        enum: AdminRole,
        description: 'The authorization role of the admin',
        example: AdminRole.ADMIN,
    })
    readonly role!: AdminRole;

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
