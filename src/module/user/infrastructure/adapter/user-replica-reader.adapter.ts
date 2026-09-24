/**
 * @file user-replica-reader.adapter.ts
 * @description Drizzle implementation of the user query ports that tolerate replication lag.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TOKEN_DATABASE_REPLICA_CLIENT, translateConnectionFailure } from 'src/core/database';
import { type IListUsersPort } from 'src/module/user/application/query/list-users/port';
import { type ListUsersResult } from 'src/module/user/application/query/list-users/query';
import { user } from 'src/module/user/infrastructure/user.schema';
import type { PaginationParams } from 'src/shared/pagination';
import type { SearchParams } from 'src/shared/search';

/**
 * Implements the user query ports on the replica connection: presentational reads that may trail
 * the primary by the replication lag. A read that feeds a write decision or populates the cache
 * belongs to the primary reader.
 */
@Injectable()
export class UserReplicaReaderAdapter implements IListUsersPort {
    /**
     * Connects user listings to the replica database.
     *
     * @param database The Drizzle client on the replica connection
     */
    constructor(@Inject(TOKEN_DATABASE_REPLICA_CLIENT) private readonly database: NodePgDatabase) {}

    /**
     * Retrieves a paginated list of non-deleted user read-models, optionally filtered by a
     * case-insensitive name/email search.
     *
     * @param params The search filter and pagination limits
     * @returns Paginated list of users
     */
    async listUsers(params: SearchParams & PaginationParams): Promise<ListUsersResult> {
        let searchFilter: SQL | undefined;

        if (params.search) {
            const pattern = `%${params.search}%`;
            searchFilter = or(ilike(user.name, pattern), ilike(user.email, pattern));
        }

        const conditions = and(searchFilter, isNull(user.deletedAt));

        try {
            const [data, countResult] = await Promise.all([
                this.database
                    .select({
                        id: user.id,
                        email: user.email,
                        name: user.name,
                        permissions: user.permissions,
                        isBanned: user.isBanned,
                    })
                    .from(user)
                    .where(conditions)
                    .orderBy(desc(user.id))
                    .limit(params.limit)
                    .offset((params.page - 1) * params.limit),
                this.database.select({ total: count() }).from(user).where(conditions),
            ]);

            return { data, total: countResult[0]?.total ?? 0 };
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }
}
