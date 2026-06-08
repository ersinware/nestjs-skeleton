/**
 * @file get-created-admin.dto.ts
 * @description Data transfer object defining the structure of a newly created admin response.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { Equals } from 'class-validator';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';
import { GetAdminDto } from './get-admin.dto';

/**
 * DTO representing response data of a newly created admin.
 * Constrains the role field exclusively to ADMIN.
 */
@ApiSchema({ name: 'GetCreatedAdmin', description: 'Response schema for a newly created admin account' })
@Exclude()
export class GetCreatedAdminDto extends GetAdminDto {
    /**
     * The role of the created admin (guaranteed to be admin).
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
