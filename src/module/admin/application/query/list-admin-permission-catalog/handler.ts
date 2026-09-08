/**
 * @file handler.ts
 * @description Handler for ListAdminPermissionCatalogQuery.
 */
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
    ListAdminPermissionCatalogQuery,
    type ListAdminPermissionCatalogResult,
} from 'src/module/admin/application/query/list-admin-permission-catalog/query';
import { getHoldablePermissions, Permission, PrincipalType } from 'src/shared/domain/principal';

/**
 * Returns the admin permission catalog: every permission an admin may hold, minus the root marker,
 * which is held by exactly one account and never granted. No outbound port: the catalog is shared
 * domain vocabulary fixed in code, not a data source, so a port would narrow nothing.
 */
@QueryHandler(ListAdminPermissionCatalogQuery)
export class ListAdminPermissionCatalogQueryHandler implements IQueryHandler<
    ListAdminPermissionCatalogQuery,
    ListAdminPermissionCatalogResult
> {
    /**
     * Executes the query.
     *
     * @returns The permissions an admin may be granted
     */
    execute(): Promise<ListAdminPermissionCatalogResult> {
        return Promise.resolve({
            permissions: getHoldablePermissions(PrincipalType.ADMIN).filter(
                (permission) => permission !== Permission.ADMIN_ROOT,
            ),
        });
    }
}
