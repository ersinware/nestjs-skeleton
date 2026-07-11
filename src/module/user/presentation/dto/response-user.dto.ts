/**
 * @file response-user.dto.ts
 * @description Defines the serialization schema for safely exposing user records to clients without leaking sensitive data like passwords or soft-delete timestamps.
 */

import { ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsEntityId, IsUserEmail, IsUserName } from 'src/core/http';

/**
 * The secure serialization schema for a user profile.
 * Implements a strict whitelist approach (Exclude/Expose) to guarantee no internal fields leak.
 */
@Exclude()
@ApiSchema({ name: 'ResponseUser', description: 'Standard user response schema.' })
export class ResponseUserDto {
    /**
     * The public-facing unique identifier of the user.
     */
    @Expose()
    @IsEntityId('The user ID')
    readonly id!: string;

    /**
     * The verified email address of the user.
     */
    @Expose()
    @IsUserEmail('The email address')
    readonly email!: string;

    /**
     * The display name of the user.
     */
    @Expose()
    @IsUserName('The full name')
    readonly name!: string;
}
