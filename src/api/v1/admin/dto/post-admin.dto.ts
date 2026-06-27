/**
 * @file post-admin.dto.ts
 * @description Defines the input validation schema for creating a new administrative account. It ensures that email and name formats strictly conform to system requirements before attempting to persist the record.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsUserEmail } from 'src/common/validation/decorator/email.decorator';
import { IsUserName } from 'src/common/validation/decorator/name.decorator';

/**
 * DTO for validating new admin account credentials and roles.
 * Acts as the boundary contract between the client request and the internal creation service.
 */
@ApiSchema({
    name: 'PostAdmin',
    description: 'Input validation schema for administrative account creation by Super Admins',
})
export class PostAdminDto {
    /**
     * Unique email address for the admin account.
     * Used as the primary login credential and communication channel.
     */
    @IsUserEmail('The email address')
    readonly email!: string;

    /**
     * The full name of the admin.
     * Displayed in the administrative dashboard and used in welcome emails.
     */
    @IsUserName('The full name')
    readonly name!: string;
}
