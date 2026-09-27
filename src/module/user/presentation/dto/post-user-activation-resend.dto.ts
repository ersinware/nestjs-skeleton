/**
 * @file post-user-activation-resend.dto.ts
 * @description Request schema for resending user activation email.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsEmailAddress } from 'src/core/http';

/**
 * Email address supplied to request another activation link.
 */
@ApiSchema({ name: 'PostUserActivationResend', description: 'Request another user activation email.' })
export class PostUserActivationResendDto {
    /**
     * The account email address; normalized before lookup.
     */
    @IsEmailAddress()
    readonly email!: string;
}
