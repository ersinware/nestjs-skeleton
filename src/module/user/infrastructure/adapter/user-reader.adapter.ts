/**
 * @file user-reader.adapter.ts
 * @description The Drizzle ORM implementation of the user reader ports. Handles data retrieval for queries, returning flat read-models directly.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, isNull, or } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE_CLIENT } from 'src/core/database';
import { type IGetUserAuthStatePort } from 'src/module/user/application/query/get-user-auth-state/port';
import { type GetUserAuthStateResult } from 'src/module/user/application/query/get-user-auth-state/query';
import { type IGetUserByIdPort } from 'src/module/user/application/query/get-user-by-id/port';
import { type GetUserByIdResult } from 'src/module/user/application/query/get-user-by-id/query';
import { type IGetUserCredentialsByEmailPort } from 'src/module/user/application/query/get-user-credentials-by-email/port';
import { type GetUserCredentialsByEmailResult } from 'src/module/user/application/query/get-user-credentials-by-email/query';
import { type IGetUserSessionVersionPort } from 'src/module/user/application/query/get-user-session-version/port';
import { type GetUserSessionVersionResult } from 'src/module/user/application/query/get-user-session-version/query';
import { type IListUsersPort } from 'src/module/user/application/query/list-users/port';
import { type ListUsersResult } from 'src/module/user/application/query/list-users/query';
import { user } from 'src/module/user/infrastructure/user.schema';
import type { PaginationParams } from 'src/shared/pagination';
import type { SearchParams } from 'src/shared/search';

/**
 * Implements query-specific reader ports with direct SQL projection queries.
 * Never instantiates aggregate roots — maps rows straight to flat read-models.
 */
@Injectable()
export class UserReaderAdapter
    implements
        IGetUserAuthStatePort,
        IGetUserByIdPort,
        IGetUserCredentialsByEmailPort,
        IListUsersPort,
        IGetUserSessionVersionPort
{
    /**
     * Initializes the user query repository with the database connection.
     *
     * @param db The PostgresJs database instance
     */
    constructor(@Inject(TOKEN_DATABASE_CLIENT) private readonly db: PostgresJsDatabase) {}

    /**
     * Reads a user's active status and current session version by ID.
     *
     * @param id The unique identifier
     * @returns The auth state, or null if not found
     */
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

    /**
     * Retrieves a non-deleted user's read-model by ID.
     *
     * @param id The unique identifier
     * @returns The user read-model, or null if not found
     */
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

    /**
     * Retrieves credential fields for a non-deleted user by email.
     *
     * @param email The exact email address
     * @returns The minimal credential projection or null if not found
     */
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

    /**
     * Retrieves a paginated list of non-deleted user read-models, optionally filtered by a
     * case-insensitive name/email search.
     *
     * @param params The search filter and pagination limits
     * @returns Paginated list of users
     */
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

    /**
     * Retrieves the session-version projection by ID. Deliberately ignores soft deletion so a
     * deleted user still resolves, letting session reconciliation converge instead of throwing and
     * looping.
     *
     * @param id The unique identifier
     * @returns The session-version projection, or null if no row exists
     */
    async getSessionVersion(id: string): Promise<GetUserSessionVersionResult | null> {
        const row = (await this.db.select({ version: user.version }).from(user).where(eq(user.id, id)).limit(1))[0];

        return row ?? null;
    }
}
