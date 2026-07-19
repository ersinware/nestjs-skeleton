/**
 * @file response-created-admin.dto.ts
 * @description Defines the structure of the response payload immediately after an admin is created. It inherits the standard admin response but enforces stricter validation on the role to guarantee newly created users are standard admins, not super admins.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { ResponseAdminDto } from 'src/module/admin/presentation/dto/response-admin.dto';
import { AdminRole } from 'src/shared/domain/admin';

/**
 * DTO representing response data of a newly created admin.
 * Constrains the role field exclusively to ADMIN to verify the system boundary.
 */
@Exclude()
@ApiSchema({ name: 'ResponseCreatedAdmin', description: 'Response schema for a newly created admin account' })
export class ResponseCreatedAdminDto extends ResponseAdminDto {
    /**
     * The role of the created admin (guaranteed to be admin).
     * Prevents accidental elevation of privileges during the creation flow.
     */
    @Expose()
    @ApiProperty({
        type: String,
        enum: [AdminRole.ADMIN],
        description: 'The authorization role of the admin',
        example: AdminRole.ADMIN,
    })
    declare readonly role: AdminRole.ADMIN;
}
