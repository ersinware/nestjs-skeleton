/**
 * @file response-user-login.dto.ts
 * @description Response alternatives for a user credential login.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { SessionOutcome } from 'src/core/security/session';
import { ResponseTokensDto } from 'src/module/auth/presentation/dto/response-tokens.dto';

/**
 * User login that opened a session and issued tokens.
 */
@Exclude()
@ApiSchema({ name: 'ResponseUserLoginSession', description: 'User authenticated and a session opened.' })
export class ResponseUserLoginSessionDto extends ResponseTokensDto {
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
