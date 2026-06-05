/**
 * @file get-user.dto.ts
 * @description Data transfer object defining the structure of a user record response.
 */

import { ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsEntityId } from 'src/common/decorator/entity-id.decorator';
import { IsUserEmail } from 'src/common/decorator/email.decorator';
import { IsUserName } from 'src/common/decorator/name.decorator';

/**
 * DTO representing user response data.
 * Sanitizes and whitelist-exposes fields, excluding passwords and internal identifiers.
 */
@ApiSchema({ name: 'GetUser', description: 'Standard user response schema excluding sensitive data' })
@Exclude()
export class GetUserDto {
    /**
     * The unique database identifier of the user.
     */
    @Expose()
    @IsEntityId('The user ID')
    readonly id!: string;

    /**
     * The email address of the user.
     */
    @Expose()
    @IsUserEmail('The email address')
    readonly email!: string;

    /**
     * The full name of the user.
     */
    @Expose()
    @IsUserName('The full name')
    readonly name!: string;
}
