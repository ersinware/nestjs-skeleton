/**
 * @file response-user.dto.ts
 * @description Response schema for user records.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsEmailAddress, IsPermissionList, IsPersonName, isUUID } from 'src/core/http';
import type { Permission } from 'src/shared/domain/principal';

/**
 * Whitelist-exposes the client-safe user fields; anything not exposed here — the password hash in
 * particular — can never reach a client.
 */
@Exclude()
@ApiSchema({ name: 'ResponseUser', description: 'Standard user response schema.' })
export class ResponseUserDto {
    /**
     * The unique identifier of the user, used to address follow-up operations.
     */
    @Expose()
    @isUUID('The user ID')
    readonly id!: string;

    /**
     * The email address of the user.
     */
    @Expose()
    @IsEmailAddress({ normalize: false })
    readonly email!: string;

    /**
     * The display name of the user.
     */
    @Expose()
    @IsPersonName({ normalize: false })
    readonly name!: string;

    /**
     * Current avatar object key; the client owns its delivery URL.
     */
    @Expose()
    @ApiProperty({
        type: String,
        description: 'The attached avatar object key.',
        example: 'avatar/user/019a3b7c-8d42-7e19-9a65-c3f821b6d047/019a3b81-2f96-74c8-bd30-e7a15942c6f3',
    })
    readonly avatarKey!: string;

    /**
     * The permissions the user holds, so the back office can show and edit them.
     */
    @Expose()
    @IsPermissionList('The permissions the user holds')
    readonly permissions!: readonly Permission[];

    /**
     * Whether the account is currently banned, so the back office can offer the matching
     * ban/unban action.
     */
    @Expose()
    @ApiProperty({
        type: Boolean,
        description: 'Whether the user account is currently banned',
        example: false,
    })
    readonly isBanned!: boolean;
}
