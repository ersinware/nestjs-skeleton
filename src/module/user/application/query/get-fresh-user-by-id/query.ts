/**
 * @file query.ts
 * @description Uncached primary read for the user projection returned after a mutation.
 */

import { Query } from '@nestjs/cqrs';
import type { GetUserByIdResult } from 'src/module/user/application/query/get-user-by-id/query';

/**
 * Fetches the current public user projection without cache or replication lag.
 */
export class GetFreshUserByIdQuery extends Query<GetFreshUserByIdResult> {
    /**
     * Initializes the query with the target identifier.
     *
     * @param id The unique identifier of the user
     */
    constructor(readonly id: string) {
        super();
    }
}

/**
 * The public user projection read from the primary after a mutation.
 */
export type GetFreshUserByIdResult = GetUserByIdResult;
