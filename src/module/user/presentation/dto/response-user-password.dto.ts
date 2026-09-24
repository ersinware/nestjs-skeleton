/**
 * @file response-user-password.dto.ts
 * @description Response alternatives for a committed user password change.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsJwtToken } from 'src/core/http';

/**
 * A password change that opened a replacement session for this client.
 */
@Exclude()
@ApiSchema({ name: 'ResponseUserPasswordSession', description: 'Password changed and a new session opened.' })
export class ResponseUserPasswordSessionDto {
    /**
     * Identifies the result carrying a fresh token pair.
     */
    @Expose()
    @ApiProperty({ type: String, enum: ['created'], example: 'created', description: 'A new session was created.' })
    readonly session!: 'created';

    /**
     * The replacement access token.
     */
    @Expose()
    @IsJwtToken('Replacement access token.')
    readonly accessToken!: string;

    /**
     * The replacement refresh token.
     */
    @Expose()
    @IsJwtToken('Replacement refresh token.')
    readonly refreshToken!: string;
}

/**
 * A committed password change whose client must sign in with the new password.
 */
@Exclude()
@ApiSchema({
    name: 'ResponseUserPasswordLoginRequired',
    description: 'Password changed; sign in with the new password.',
})
export class ResponseUserPasswordLoginRequiredDto {
    /**
     * Instructs the client to discard its old tokens and sign in again.
     */
    @Expose()
    @ApiProperty({
        type: String,
        enum: ['login_required'],
        example: 'login_required',
        description:
            'Password changed, but session storage was unavailable or a newer session version superseded this change. Discard old tokens and sign in with the new password.',
    })
    readonly session!: 'login_required';
}
