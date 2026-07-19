/**
 * @file response-admin.dto.ts
 * @description Defines the structure of the data returned when querying admin records. It explicitly sanitizes the output to ensure sensitive data (like password hashes or internal markers) is never leaked to the client.
 */

import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsEntityId, IsUserEmail, IsUserName } from 'src/core/http';
import { AdminRole } from 'src/shared/domain/admin';

/**
 * DTO representing admin response data.
 * Sanitizes and whitelist-exposes fields, excluding passwords and internal identifiers.
 */
@Exclude()
@ApiSchema({ name: 'ResponseAdmin', description: 'Standard admin response schema.' })
export class ResponseAdminDto {
    /**
     * The unique database identifier of the admin.
     * Exposed to allow clients to perform subsequent operations (update, delete) on this specific entity.
     */
    @Expose()
    @IsEntityId('The admin ID')
    readonly id!: string;

    /**
     * The email address of the admin.
     * Exposed for display and identification purposes in the user interface.
     */
    @Expose()
    @IsUserEmail('The email address')
    readonly email!: string;

    /**
     * The full name of the admin.
     * Exposed for personalization and display in the administrative dashboard.
     */
    @Expose()
    @IsUserName('The full name')
    readonly name!: string;

    /**
     * The role of the admin.
     * Exposed so the client application can render role-specific UI components or enforce client-side guardrails.
     */
    @Expose()
    @ApiProperty({
        type: String,
        enum: [AdminRole.ADMIN, AdminRole.SUPER_ADMIN],
        description: 'The authorization role of the admin',
        example: AdminRole.ADMIN,
    })
    readonly role!: AdminRole;
}
