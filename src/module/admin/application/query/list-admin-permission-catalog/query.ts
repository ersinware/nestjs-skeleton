/**
 * @file query.ts
 * @description Query that lists the permissions an admin may be granted.
 */

import { Query } from '@nestjs/cqrs';
import type { Permission } from 'src/shared/domain/principal';

/**
 * Lists the grantable admin catalog, as the permission-management screen offers it.
 */
export class ListAdminPermissionCatalogQuery extends Query<ListAdminPermissionCatalogResult> {}

/**
 * Every permission an admin may hold, in catalog order.
 */
export type ListAdminPermissionCatalogResult = {
    /**
     * Permissions this principal kind may be granted.
     */
    readonly permissions: readonly Permission[];
};
