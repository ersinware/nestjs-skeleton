/**
 * @file post-admin.dto.ts
 * @description Input validation DTO for administrative account creation by Super Admins.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsUserEmail } from 'src/common/decorator/validator/email.decorator';
import { IsUserName } from 'src/common/decorator/validator/name.decorator';

/**
 * DTO for validating new admin account credentials and roles.
 */
@ApiSchema({
    name: 'PostAdmin',
    description: 'Input validation schema for administrative account creation by Super Admins',
})
export class PostAdminDto {
    /**
     * Unique email address for the admin account.
     */
    @IsUserEmail('The email address')
    readonly email!: string;

    /**
     * The full name of the admin.
     */
    @IsUserName('The full name')
    readonly name!: string;
}
