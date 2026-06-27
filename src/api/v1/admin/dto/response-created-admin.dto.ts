/**
 * @file response-created-admin.dto.ts
 * @description Defines the structure of the response payload immediately after an admin is created. It inherits the standard admin response but enforces stricter validation on the role to guarantee newly created users are standard admins, not super admins.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { Equals } from 'class-validator';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { ResponseAdminDto } from './response-admin.dto';

/**
 * DTO representing response data of a newly created admin.
 * Constrains the role field exclusively to ADMIN to verify the system boundary.
 */
@ApiSchema({ name: 'ResponseCreatedAdmin', description: 'Response schema for a newly created admin account' })
@Exclude()
export class ResponseCreatedAdminDto extends ResponseAdminDto {
    /**
     * The role of the created admin (guaranteed to be admin).
     * Prevents accidental elevation of privileges during the creation flow.
     */
    @Expose()
    @Equals(AuthUserRole.ADMIN)
    @ApiProperty({
        type: 'string',
        enum: [AuthUserRole.ADMIN],
        description: 'The role assigned to the admin.',
        example: AuthUserRole.ADMIN,
    })
    declare readonly role: AuthUserRole.ADMIN;
}
