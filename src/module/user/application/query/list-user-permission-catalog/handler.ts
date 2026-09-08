/**
 * @file handler.ts
 * @description Handler for ListUserPermissionCatalogQuery.
 */
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import {
    ListUserPermissionCatalogQuery,
    type ListUserPermissionCatalogResult,
} from 'src/module/user/application/query/list-user-permission-catalog/query';
import { getHoldablePermissions, PrincipalType } from 'src/shared/domain/principal';

/**
 * Returns the user permission catalog. No outbound port: the catalog is shared domain vocabulary
 * fixed in code, not a data source, so a port would narrow nothing.
 */
@QueryHandler(ListUserPermissionCatalogQuery)
export class ListUserPermissionCatalogQueryHandler implements IQueryHandler<
    ListUserPermissionCatalogQuery,
    ListUserPermissionCatalogResult
> {
    /**
     * Executes the query.
     *
     * @returns The permissions a user may be granted
     */
    execute(): Promise<ListUserPermissionCatalogResult> {
        return Promise.resolve({ permissions: getHoldablePermissions(PrincipalType.USER) });
    }
}
