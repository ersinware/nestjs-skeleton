/**
 * @file post-login.dto.ts
 * @description Defines the input validation schema for user and admin login requests. Validates credentials at the transport layer before business logic execution.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsStrongPassword, IsUserEmail } from 'src/core/http';

/**
 * DTO for validating user or admin credentials during authentication login.
 * Ensures the payload matches strict email and password complexity requirements to thwart basic injection or malformed requests.
 */
@ApiSchema({ name: 'PostLogin', description: 'Input validation schema for user or admin login credentials' })
export class PostLoginDto {
    /**
     * Unique email address associated with the user or admin account.
     * Serves as the primary identifier during authentication.
     */
    @IsUserEmail('The email address')
    readonly email!: string;

    /**
     * Cleartext password associated with the account.
     * Must pass strict complexity checks before being evaluated against the stored hash.
     */
    @IsStrongPassword('The password')
    readonly password!: string;
}
