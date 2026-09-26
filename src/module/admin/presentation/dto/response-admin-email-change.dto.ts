/**
 * @file response-admin-email-change.dto.ts
 * @description Response alternatives for a committed admin email change.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsJwtToken } from 'src/core/http';
import { SessionOutcome } from 'src/core/security/session';

/**
 * An email change that opened a replacement session for this client.
 */
@Exclude()
@ApiSchema({ name: 'ResponseAdminEmailChangeSession', description: 'Email changed and a new session opened.' })
export class ResponseAdminEmailChangeSessionDto {
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
 * A committed email change whose client must sign in with the new email address.
 */
@Exclude()
@ApiSchema({
    name: 'ResponseAdminEmailChangeLoginRequired',
    description: 'Email changed; sign in with the new email address.',
})
export class ResponseAdminEmailChangeLoginRequiredDto {
    /**
     * Instructs the client to discard its old tokens and sign in again.
     */
    @Expose()
    @ApiProperty({
        type: String,
        enum: [SessionOutcome.LOGIN_REQUIRED],
        example: SessionOutcome.LOGIN_REQUIRED,
        description:
            'Email changed, but session storage was unavailable or a newer session version superseded this change. Discard old tokens and sign in with the new email address.',
    })
    readonly session!: SessionOutcome.LOGIN_REQUIRED;
}
