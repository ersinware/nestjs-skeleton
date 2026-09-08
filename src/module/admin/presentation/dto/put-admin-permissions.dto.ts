/**
 * @file put-admin-permissions.dto.ts
 * @description Request schema replacing an admin's permission set.
 */

import { ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsPermissionList } from 'src/core/http';
import type { Permission } from 'src/shared/domain/principal';

/**
 * The complete permission set an admin should hold afterwards. Whole-set on purpose: the client
 * states the end state, so a retry is harmless and the server can name exactly what changed.
 */
@Exclude()
@ApiSchema({
    name: 'PutAdminPermissions',
    description: "Input validation schema for replacing an admin's permission set.",
})
export class PutAdminPermissionsDto {
    /**
     * Every permission the admin should hold; anything not listed is revoked.
     */
    @Expose()
    @IsPermissionList('The permission set')
    readonly permissions!: readonly Permission[];
}
