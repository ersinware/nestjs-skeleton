/**
 * @file response-admin-password.dto.ts
 * @description Response alternatives for a committed admin password change.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsJwtToken } from 'src/core/http';
import { SessionOutcome } from 'src/core/security/session';

/**
 * A password change that opened a replacement session for this client.
 */
@Exclude()
@ApiSchema({ name: 'ResponseAdminPasswordSession', description: 'Password changed and a new session opened.' })
export class ResponseAdminPasswordSessionDto {
    /**
     * Identifies the result carrying a fresh token pair.
     */
    @Expose()
    @ApiProperty({
        type: String,
        enum: [SessionOutcome.CREATED],
        example: SessionOutcome.CREATED,
        description: 'A new session was created.',
    })
    readonly session!: SessionOutcome.CREATED;

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
    name: 'ResponseAdminPasswordLoginRequired',
    description: 'Password changed; sign in with the new password.',
})
export class ResponseAdminPasswordLoginRequiredDto {
    /**
     * Instructs the client to discard its old tokens and sign in again.
     */
    @Expose()
    @ApiProperty({
        type: String,
        enum: [SessionOutcome.LOGIN_REQUIRED],
        example: SessionOutcome.LOGIN_REQUIRED,
        description:
            'Password changed, but session storage was unavailable or a newer session version superseded this change. Discard old tokens and sign in with the new password.',
    })
    readonly session!: SessionOutcome.LOGIN_REQUIRED;
}
