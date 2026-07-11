/**
 * @file user-reader.adapter.ts
 * @description The Drizzle ORM implementation of the user reader ports. Handles data retrieval for queries, returning flat read-models directly.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE } from 'src/core/database';
import {
    type CheckUserIsActiveResult,
    type ICheckUserIsActivePort,
} from 'src/module/user/application/query/check-user-is-active';
import { type GetUserByIdResult, type IGetUserByIdPort } from 'src/module/user/application/query/get-user-by-id';
import {
    type GetUserCredentialsByEmailResult,
    type IGetUserCredentialsByEmailPort,
} from 'src/module/user/application/query/get-user-credentials-by-email';
import {
    type GetUserCredentialsByIdResult,
    type IGetUserCredentialsByIdPort,
} from 'src/module/user/application/query/get-user-credentials-by-id';
import { type IListUsersPort, type ListUsersResult } from 'src/module/user/application/query/list-users';
import { user } from 'src/module/user/infrastructure/database/schema';
import type { PaginationParams } from 'src/shared/pagination';
import type { SearchParams } from 'src/shared/search';

@Injectable()
export class UserReaderAdapter
    implements
        ICheckUserIsActivePort,
        IGetUserByIdPort,
        IGetUserCredentialsByEmailPort,
        IGetUserCredentialsByIdPort,
        IListUsersPort
{
    constructor(@Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase) {}

    async checkIsActive(id: string): Promise<CheckUserIsActiveResult | null> {
        const row = (
            await this.db
                .select({ isActive: user.isActive })
                .from(user)
                .where(and(eq(user.id, id), isNull(user.deletedAt)))
                .limit(1)
        )[0];

        return row ? row.isActive : null;
    }

    async getById(id: string): Promise<GetUserByIdResult | null> {
        const row = (
            await this.db
                .select({
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    isActive: user.isActive,
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
                    isActive: user.isActive,
                })
                .from(user)
                .where(and(eq(user.email, email), isNull(user.deletedAt)))
                .limit(1)
        )[0];

        return row ?? null;
    }

    async getCredentialsById(id: string): Promise<GetUserCredentialsByIdResult | null> {
        const row = (
            await this.db
                .select({
                    id: user.id,
                    password: user.password,
                    isActive: user.isActive,
                })
                .from(user)
                .where(and(eq(user.id, id), isNull(user.deletedAt)))
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
                    isActive: user.isActive,
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
