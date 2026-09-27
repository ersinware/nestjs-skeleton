/**
 * @file response-user-login.dto.ts
 * @description Response alternatives for a user credential login.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsJwtToken } from 'src/core/http';
import { SessionOutcome } from 'src/core/security/session';

/**
 * User login that opened a session and issued tokens.
 */
@Exclude()
@ApiSchema({ name: 'ResponseUserLoginSession', description: 'User authenticated and a session opened.' })
export class ResponseUserLoginSessionDto {
    /**
     * Identifies the result carrying a token pair.
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
    @IsJwtToken('JWT Access Token')
    readonly accessToken!: string;

    /**
     * Refresh token issued for the new session.
     */
    @Expose()
    @IsJwtToken('The newly issued refresh token')
    readonly refreshToken!: string;
}

/**
 * Correct credentials for a user still awaiting email activation.
 */
@Exclude()
@ApiSchema({ name: 'ResponseUserLoginActivationRequired', description: 'Activate the account before signing in.' })
export class ResponseUserLoginActivationRequiredDto {
    /**
     * Instructs the client to offer activation and resend without treating this as a session.
     */
    @Expose()
    @ApiProperty({
        type: String,
        enum: [SessionOutcome.ACTIVATION_REQUIRED],
        example: SessionOutcome.ACTIVATION_REQUIRED,
        description: 'The account requires email activation; no tokens were issued.',
    })
    readonly session!: SessionOutcome.ACTIVATION_REQUIRED;
}
