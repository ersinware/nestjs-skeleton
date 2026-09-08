/**
 * @file query.ts
 * @description Query that lists the permissions a user may be granted.
 */

import { Query } from '@nestjs/cqrs';
import type { Permission } from 'src/shared/domain/principal';

/**
 * Lists the grantable user catalog, as the permission-management screen offers it.
 */
export class ListUserPermissionCatalogQuery extends Query<ListUserPermissionCatalogResult> {}

/**
 * Every permission a user may hold, in catalog order.
 */
export type ListUserPermissionCatalogResult = {
    readonly permissions: readonly Permission[];
};
