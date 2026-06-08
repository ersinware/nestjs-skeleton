/**
 * @file get-admin.dto.ts
 * @description Data transfer object defining the structure of an admin record response.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsEnum } from 'class-validator';
import { IsEntityId } from 'src/common/decorator/validator/entity-id.decorator';
import { IsUserEmail } from 'src/common/decorator/validator/email.decorator';
import { IsUserName } from 'src/common/decorator/validator/name.decorator';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';

/**
 * DTO representing admin response data.
 * Sanitizes and whitelist-exposes fields, excluding passwords and internal identifiers.
 */
@ApiSchema({ name: 'GetAdmin', description: 'Standard admin response schema excluding sensitive data' })
@Exclude()
export class GetAdminDto {
    /**
     * The unique database identifier of the admin.
     */
    @Expose()
    @IsEntityId('The admin ID')
    readonly id!: string;

    /**
     * The email address of the admin.
     */
    @Expose()
    @IsUserEmail('The email address')
    readonly email!: string;

    /**
     * The full name of the admin.
     */
    @Expose()
    @IsUserName('The full name')
    readonly name!: string;

    /**
     * The role of the admin.
     */
    @Expose()
    @IsEnum(AuthUserRole)
    @ApiProperty({
        description: 'The role assigned to the admin.',
        enum: [AuthUserRole.ADMIN, AuthUserRole.SUPER_ADMIN],
        example: AuthUserRole.ADMIN,
    })
    readonly role!: AuthUserRole.ADMIN | AuthUserRole.SUPER_ADMIN;
}
