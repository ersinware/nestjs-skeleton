/**
 * @file admin-reader.adapter.ts
 * @description Read-only Drizzle ORM implementation of specific query ports. Selects only the columns
 * required by each read-model, avoiding full aggregate reconstitution on the read path.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE } from 'src/core/database';
import {
    type GetAdminAccessProjectionResult,
    type IGetAdminAccessProjectionPort,
} from 'src/module/admin/application/query/get-admin-access-projection';
import {
    type GetAdminAuthStateResult,
    type IGetAdminAuthStatePort,
} from 'src/module/admin/application/query/get-admin-auth-state';
import {
    type GetAdminCredentialsByEmailResult,
    type IGetAdminCredentialsByEmailPort,
} from 'src/module/admin/application/query/get-admin-credentials-by-email';
import {
    type GetAdminEmailAndNameResult,
    type IGetAdminEmailAndNamePort,
} from 'src/module/admin/application/query/get-admin-email-and-name';
import { type IListAdminsPort, type ListAdminsResult } from 'src/module/admin/application/query/list-admins';
import { admin } from 'src/module/admin/infrastructure/database/schema';
import { PaginationParams } from 'src/shared/pagination';

/**
 * Implements query-specific reader ports with direct SQL projection queries.
 * Never instantiates aggregate roots — maps rows straight to flat read-models.
 */
@Injectable()
export class AdminReaderAdapter
    implements
        IGetAdminAuthStatePort,
        IGetAdminCredentialsByEmailPort,
        IGetAdminEmailAndNamePort,
        IGetAdminAccessProjectionPort,
        IListAdminsPort
{
    /**
     * Initializes the admin query repository with the database connection.
     *
     * @param db The PostgresJs database instance
     */
    constructor(@Inject(TOKEN_DATABASE) private readonly db: PostgresJsDatabase) {}

    /**
     * Reads an admin's active status and current session version by ID.
     *
     * @param id The unique identifier
     * @returns The auth state, or null if not found
     */
    async getAuthState(id: string): Promise<GetAdminAuthStateResult | null> {
        return (
            (
                await this.db
                    .select({ isBanned: admin.isBanned, version: admin.version })
                    .from(admin)
                    .where(and(eq(admin.id, id), isNull(admin.deletedAt)))
                    .limit(1)
            )[0] ?? null
        );
    }

    /**
     * Retrieves credential fields for a non-deleted admin by email.
     *
     * @param email The exact email address
     * @returns The minimal credential projection or null if not found
     */
    async getCredentialsByEmail(email: string): Promise<GetAdminCredentialsByEmailResult | null> {
        return (
            (
                await this.db
                    .select({
                        id: admin.id,
                        password: admin.password,
                        role: admin.role,
                        isBanned: admin.isBanned,
                        version: admin.version,
                    })
                    .from(admin)
                    .where(and(eq(admin.email, email), isNull(admin.deletedAt)))
                    .limit(1)
            )[0] ?? null
        );
    }

    /**
     * Retrieves only the email and name of a non-deleted admin by ID.
     *
     * @param id The unique identifier
     * @returns An object containing email and name, or null if not found
     */
    async getAdminEmailAndName(id: string): Promise<GetAdminEmailAndNameResult | null> {
        return (
            (
                await this.db
                    .select({ email: admin.email, name: admin.name })
                    .from(admin)
                    .where(and(eq(admin.id, id), isNull(admin.deletedAt)))
                    .limit(1)
            )[0] ?? null
        );
    }

    /**
     * Reads the session version of an admin by ID. Deliberately omits the soft-delete filter so a
     * deleted admin still resolves, letting session reconciliation converge instead of throwing and
     * looping.
     *
     * @param id The unique identifier
     * @returns The session-version projection, or null if no row exists
     */
    async getAdminAccessProjection(id: string): Promise<GetAdminAccessProjectionResult | null> {
        const row = (await this.db.select({ version: admin.version }).from(admin).where(eq(admin.id, id)).limit(1))[0];

        return row ?? null;
    }

    /**
     * Retrieves a paginated list of non-deleted admin read-models.
     *
     * @param params The pagination limits
     * @returns Paginated list of admins
     */
    async listAdmins(params: PaginationParams): Promise<ListAdminsResult> {
        const conditions = isNull(admin.deletedAt),
            [rows, countResult] = await Promise.all([
                this.db
                    .select({
                        id: admin.id,
                        email: admin.email,
                        name: admin.name,
                        role: admin.role,
                        isBanned: admin.isBanned,
                        createdAt: admin.createdAt,
                        updatedAt: admin.updatedAt,
                    })
                    .from(admin)
                    .where(conditions)
                    .orderBy(desc(admin.id))
                    .limit(params.limit)
                    .offset((params.page - 1) * params.limit),
                this.db.select({ total: count() }).from(admin).where(conditions),
            ]);

        return { data: rows, total: countResult[0]?.total ?? 0 };
    }
}
