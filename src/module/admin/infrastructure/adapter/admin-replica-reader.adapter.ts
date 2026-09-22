/**
 * @file admin-replica-reader.adapter.ts
 * @description Drizzle implementation of the admin query ports that tolerate replication lag.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TOKEN_DATABASE_REPLICA_CLIENT, translateConnectionFailure } from 'src/core/database';
import { type IGetAdminByIdPort } from 'src/module/admin/application/query/get-admin-by-id/port';
import { type GetAdminByIdResult } from 'src/module/admin/application/query/get-admin-by-id/query';
import { type IListAdminsPort } from 'src/module/admin/application/query/list-admins/port';
import { type ListAdminsResult } from 'src/module/admin/application/query/list-admins/query';
import { admin } from 'src/module/admin/infrastructure/admin.schema';
import { PaginationParams } from 'src/shared/pagination';
import type { SearchParams } from 'src/shared/search';

/**
 * Implements the admin query ports on the replica connection: presentational reads that may trail
 * the primary by the replication lag. A read that feeds a write decision or populates the cache
 * belongs to the primary reader.
 */
@Injectable()
export class AdminReplicaReaderAdapter implements IGetAdminByIdPort, IListAdminsPort {
    /**
     * @param database The Drizzle client on the replica connection
     */
    constructor(@Inject(TOKEN_DATABASE_REPLICA_CLIENT) private readonly database: NodePgDatabase) {}

    /**
     * Reads an admin projection by identifier.
     *
     * @param id The unique identifier of the target admin
     * @returns The admin projection, or null when no non-deleted admin exists
     */
    async getById(id: string): Promise<GetAdminByIdResult | null> {
        try {
            return (
                (
                    await this.database
                        .select({
                            id: admin.id,
                            email: admin.email,
                            name: admin.name,
                            permissions: admin.permissions,
                            isBanned: admin.isBanned,
                            isActivated: sql<boolean>`${admin.password} is not null`,
                        })
                        .from(admin)
                        .where(and(eq(admin.id, id), isNull(admin.deletedAt)))
                        .limit(1)
                )[0] ?? null
            );
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Reads one page of non-deleted admin read-models.
     *
     * @param params The pagination and search parameters
     * @returns The page of admins plus the total row count
     */
    async listAdmins(params: SearchParams & PaginationParams): Promise<ListAdminsResult> {
        let searchFilter: SQL | undefined;

        if (params.search) {
            const pattern = `%${params.search}%`;
            searchFilter = or(ilike(admin.name, pattern), ilike(admin.email, pattern));
        }

        const conditions = and(searchFilter, isNull(admin.deletedAt));

        try {
            const [data, countResult] = await Promise.all([
                this.database
                    .select({
                        id: admin.id,
                        email: admin.email,
                        name: admin.name,
                        permissions: admin.permissions,
                        isBanned: admin.isBanned,
                        isActivated: sql<boolean>`${admin.password} is not null`,
                    })
                    .from(admin)
                    .where(conditions)
                    .orderBy(desc(admin.id))
                    .limit(params.limit)
                    .offset((params.page - 1) * params.limit),
                this.database.select({ total: count() }).from(admin).where(conditions),
            ]);

            return { data, total: countResult[0]?.total ?? 0 };
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }
}
