/**
 * @file query.ts
 * @description Uncached primary read for the admin projection returned after a mutation.
 */

import { Query } from '@nestjs/cqrs';
import type { GetAdminByIdResult } from 'src/module/admin/application/query/get-admin-by-id/query';

/**
 * Fetches the current public admin projection without cache or replication lag.
 */
export class GetFreshAdminByIdQuery extends Query<GetFreshAdminByIdResult> {
    /**
     * Initializes the query with the target identifier.
     *
     * @param id The unique identifier of the admin
     */
    constructor(readonly id: string) {
        super();
    }
}

/**
 * The public admin projection read from the primary after a mutation.
 */
export type GetFreshAdminByIdResult = GetAdminByIdResult;
