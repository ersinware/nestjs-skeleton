/**
 * @file user-reader.adapter.ts
 * @description The Drizzle ORM implementation of the user reader ports. Handles data retrieval for queries, returning flat read-models directly.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE_CLIENT } from 'src/core/database';
import { type IGetUserAccessProjectionPort } from 'src/module/user/application/query/get-user-access-projection/port';
import { type GetUserAccessProjectionResult } from 'src/module/user/application/query/get-user-access-projection/query';
import { type IGetUserAuthStatePort } from 'src/module/user/application/query/get-user-auth-state/port';
import { type GetUserAuthStateResult } from 'src/module/user/application/query/get-user-auth-state/query';
import { type IGetUserByIdPort } from 'src/module/user/application/query/get-user-by-id/port';
import { type GetUserByIdResult } from 'src/module/user/application/query/get-user-by-id/query';
import { type IGetUserCredentialsByEmailPort } from 'src/module/user/application/query/get-user-credentials-by-email/port';
import { type GetUserCredentialsByEmailResult } from 'src/module/user/application/query/get-user-credentials-by-email/query';
import { type IListUsersPort } from 'src/module/user/application/query/list-users/port';
import { type ListUsersResult } from 'src/module/user/application/query/list-users/query';
import { user } from 'src/module/user/infrastructure/user.schema';
import type { PaginationParams } from 'src/shared/pagination';
import type { SearchParams } from 'src/shared/search';

@Injectable()
export class UserReaderAdapter
    implements
        IGetUserAuthStatePort,
        IGetUserAccessProjectionPort,
        IGetUserByIdPort,
        IGetUserCredentialsByEmailPort,
        IListUsersPort
{
    constructor(@Inject(TOKEN_DATABASE_CLIENT) private readonly db: PostgresJsDatabase) {}

    async getAuthState(id: string): Promise<GetUserAuthStateResult | null> {
        const row = (
            await this.db
                .select({ isBanned: user.isBanned, version: user.version })
                .from(user)
                .where(and(eq(user.id, id), isNull(user.deletedAt)))
                .limit(1)
        )[0];

        return row ?? null;
    }

    async getAccessProjection(id: string): Promise<GetUserAccessProjectionResult | null> {
        const row = (await this.db.select({ version: user.version }).from(user).where(eq(user.id, id)).limit(1))[0];

        return row ?? null;
    }

    async getById(id: string): Promise<GetUserByIdResult | null> {
        const row = (
            await this.db
                .select({
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    isBanned: user.isBanned,
                    createdAt: user.createdAt,
                    updatedAt: user.updatedAt,
                })
                .from(user)
                .where(and(eq(user.id, id), isNull(user.deletedAt)))
                .limit(1)
        )[0];

        return row ?? null;
    }

    async getCredentialsByEmail(email: string): Promise<GetUserCredentialsByEmailResult | null> {
        const row = (
            await this.db
                .select({
                    id: user.id,
                    password: user.password,
                    isBanned: user.isBanned,
                    version: user.version,
                })
                .from(user)
                .where(and(eq(user.email, email), isNull(user.deletedAt)))
                .limit(1)
        )[0];

        return row ?? null;
    }

    async listUsers(params: SearchParams & PaginationParams): Promise<ListUsersResult> {
        let conditions = isNull(user.deletedAt);

        if (params.search) {
            const searchPattern = `%${params.search}%`,
                searchFilter = or(ilike(user.name, searchPattern), ilike(user.email, searchPattern));

            if (searchFilter) {
                conditions = and(conditions, searchFilter)!;
            }
        }

        const [data, countResult] = await Promise.all([
            this.db
                .select({
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    isBanned: user.isBanned,
                    createdAt: user.createdAt,
                    updatedAt: user.updatedAt,
                })
                .from(user)
                .where(conditions)
                .orderBy(desc(user.id))
                .limit(params.limit)
                .offset((params.page - 1) * params.limit),
            this.db.select({ total: count() }).from(user).where(conditions),
        ]);

        return { data, total: countResult[0]?.total ?? 0 };
    }
}
