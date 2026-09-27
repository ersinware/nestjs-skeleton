/**
 * @file response-user-activation.dto.ts
 * @description Response alternatives for a committed user activation.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsJwtToken } from 'src/core/http';
import { SessionOutcome } from 'src/core/security/session';

/**
 * An activation that opened a session for the user.
 */
@Exclude()
@ApiSchema({ name: 'ResponseUserActivationSession', description: 'Account activated and a new session opened.' })
export class ResponseUserActivationSessionDto {
    /**
     * Identifies the result carrying a new token pair.
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
     * Access token issued for the new session.
     */
    @Expose()
    @IsJwtToken('Access token.')
    readonly accessToken!: string;

    /**
     * Refresh token issued for the new session.
     */
    @Expose()
    @IsJwtToken('Refresh token.')
    readonly refreshToken!: string;
}

/**
 * A committed activation whose client must sign in with its existing password.
 */
@Exclude()
@ApiSchema({ name: 'ResponseUserActivationLoginRequired', description: 'Account activated; sign in to continue.' })
export class ResponseUserActivationLoginRequiredDto {
    /**
     * Instructs the client to sign in because session registration did not succeed.
     */
    @Expose()
    @ApiProperty({
        type: String,
        enum: [SessionOutcome.LOGIN_REQUIRED],
        example: SessionOutcome.LOGIN_REQUIRED,
        description: 'Account activated, but a session could not be opened. Sign in with the existing password.',
    })
    readonly session!: SessionOutcome.LOGIN_REQUIRED;
}
