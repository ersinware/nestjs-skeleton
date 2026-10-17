/**
 * @file post-user-email-change-initiate.dto.ts
 * @description Request schema for starting an authenticated user email change.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsEmailAddress, IsStrongPassword } from 'src/core/http';

/**
 * The new address and current password authorizing a confirmation request.
 */
@ApiSchema({
    name: 'PostUserEmailChangeInitiate',
    description: 'Initiate a user email change with the current password.',
})
export class PostUserEmailChangeInitiateDto {
    /**
     * The new address to verify before replacing the current login address.
     */
    @IsEmailAddress()
    readonly newEmail!: string;

    /**
     * The current password, preserved unchanged for verification.
     */
    @IsStrongPassword('The current password')
    readonly currentPassword!: string;
}
