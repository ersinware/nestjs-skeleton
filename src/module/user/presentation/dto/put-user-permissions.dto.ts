/**
 * @file put-user-permissions.dto.ts
 * @description Request schema replacing a user's permission set.
 */

import { ApiSchema } from '@nestjs/swagger';
import { IsPermissionList } from 'src/core/http';
import type { Permission } from 'src/shared/domain/principal';

/**
 * The complete permission set a user should hold afterwards. Whole-set on purpose: the client
 * states the end state, so a retry is harmless and the server can name exactly what changed.
 */
@ApiSchema({
    name: 'PutUserPermissions',
    description: "Input validation schema for replacing a user's permission set.",
})
export class PutUserPermissionsDto {
    /**
     * Every permission the user should hold; anything not listed is revoked.
     */
    @IsPermissionList('The permission set')
    readonly permissions!: readonly Permission[];
}
