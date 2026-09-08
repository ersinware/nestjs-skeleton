/**
 * @file response-permission-catalog.dto.ts
 * @description Response schema listing the permissions one kind of principal may be granted.
 */

import { ApiSchema } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { IsPermissionList } from 'src/core/http/validation/decorator/permission-list.decorator';
import type { Permission } from 'src/shared/domain/principal';

/**
 * The grantable catalog of one kind of principal, as a management screen offers it. Shared by
 * every context that manages permissions, because the shape is the catalog's, not the context's.
 */
@Exclude()
@ApiSchema({
    name: 'ResponsePermissionCatalog',
    description: 'The permissions a kind of principal may be granted.',
})
export class ResponsePermissionCatalogDto {
    /**
     * Every permission the addressed kind of principal may hold, in catalog order.
     */
    @Expose()
    @IsPermissionList('The grantable permissions')
    readonly permissions!: readonly Permission[];
}
