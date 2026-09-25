/**
 * @file query.ts
 * @description Resolves current token claims for an account eligible to refresh the supplied token version.
 */

import { Query } from '@nestjs/cqrs';
import type { Permission } from 'src/shared/domain/principal';

/**
 * Fetches current claims only when the account and token version permit refresh.
 */
export class GetUserRefreshStateQuery extends Query<GetUserRefreshStateResult> {
    /**
     * Initializes the query with verified refresh-token claims.
     *
     * @param id The account identifier
     * @param tokenSessionVersion The verified refresh token's session version
     */
    constructor(
        readonly id: string,
        readonly tokenSessionVersion: number,
    ) {
        super();
    }
}

/**
 * Current claims for an account eligible to refresh the supplied token version.
 */
export type GetUserRefreshStateResult = {
    /**
     * Current session version used for newly issued tokens.
     */
    readonly sessionVersion: number;

    /**
     * Permissions currently assigned to the account.
     */
    readonly permissions: readonly Permission[];
};
