/**
 * @file admin-reader.adapter.ts
 * @description Drizzle implementation of every admin query port.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TOKEN_DATABASE_CLIENT, translateConnectionFailure } from 'src/core/database';
import { type IGetAdminAuthStatePort } from 'src/module/admin/application/query/get-admin-auth-state/port';
import { type GetAdminAuthStateResult } from 'src/module/admin/application/query/get-admin-auth-state/query';
import { type IGetAdminCredentialsByEmailPort } from 'src/module/admin/application/query/get-admin-credentials-by-email/port';
import { type GetAdminCredentialsByEmailResult } from 'src/module/admin/application/query/get-admin-credentials-by-email/query';
import { type IGetAdminSessionVersionPort } from 'src/module/admin/application/query/get-admin-session-version/port';
import { type GetAdminSessionVersionResult } from 'src/module/admin/application/query/get-admin-session-version/query';
import { type IListAdminsPort } from 'src/module/admin/application/query/list-admins/port';
import { type ListAdminsResult } from 'src/module/admin/application/query/list-admins/query';
import { admin } from 'src/module/admin/infrastructure/admin.schema';
import { PaginationParams } from 'src/shared/pagination';

/**
 * Implements the admin query ports with direct projection queries: selects only each read-model's
 * columns and maps rows straight to flat results, never through the aggregate. Methods are ordered
 * by expected call frequency.
 */
@Injectable()
export class AdminReaderAdapter
    implements IGetAdminAuthStatePort, IGetAdminCredentialsByEmailPort, IListAdminsPort, IGetAdminSessionVersionPort
{
    /**
     * Injects the database connection all reads run on.
     *
     * @param db The Drizzle database client
     */
    constructor(@Inject(TOKEN_DATABASE_CLIENT) private readonly db: PostgresJsDatabase) {}

    /**
     * Reads an admin's ban status and current session version.
     *
     * @param id The unique identifier of the target admin
     * @returns The auth state, or null when no non-deleted admin exists
     */
    async getAuthState(id: string): Promise<GetAdminAuthStateResult | null> {
        try {
            return (
                (
                    await this.db
                        .select({ isBanned: admin.isBanned, sessionVersion: admin.sessionVersion })
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
     * Reads an admin's credential read-model by email.
     *
     * @param email The exact email address to look up
     * @returns The credentials, or null when no non-deleted admin exists
     */
    async getCredentialsByEmail(email: string): Promise<GetAdminCredentialsByEmailResult | null> {
        try {
            return (
                (
                    await this.db
                        .select({
                            id: admin.id,
                            password: admin.password,
                            role: admin.role,
                            isBanned: admin.isBanned,
                            sessionVersion: admin.sessionVersion,
                        })
                        .from(admin)
                        .where(and(eq(admin.email, email), isNull(admin.deletedAt)))
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
     * @param params The pagination parameters
     * @returns The page of admins plus the total row count
     */
    async listAdmins(params: PaginationParams): Promise<ListAdminsResult> {
        const conditions = isNull(admin.deletedAt);

        try {
            const [data, countResult] = await Promise.all([
                this.db
                    .select({
                        id: admin.id,
                        email: admin.email,
                        name: admin.name,
                        role: admin.role,
                        isBanned: admin.isBanned,
                    })
                    .from(admin)
                    .where(conditions)
                    .orderBy(desc(admin.id))
                    .limit(params.limit)
                    .offset((params.page - 1) * params.limit),
                this.db.select({ total: count() }).from(admin).where(conditions),
            ]);

            return { data, total: countResult[0]?.total ?? 0 };
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Reads an admin's session version. Deliberately omits the soft-delete filter so a deleted admin
     * resolves to its (revoked) version and reconciliation can still converge.
     *
     * @param id The unique identifier of the target admin
     * @returns The session version, or null when no row exists
     */
    async getSessionVersion(id: string): Promise<GetAdminSessionVersionResult | null> {
        try {
            return (
                (
                    await this.db
                        .select({ sessionVersion: admin.sessionVersion })
                        .from(admin)
                        .where(eq(admin.id, id))
                        .limit(1)
                )[0] ?? null
            );
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }
}
