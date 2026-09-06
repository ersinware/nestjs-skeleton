/**
 * @file admin-reader.adapter.ts
 * @description Drizzle implementation of the admin query ports that must read the primary.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TOKEN_DATABASE_CLIENT, translateConnectionFailure } from 'src/core/database';
import { type IGetAdminAuthStatePort } from 'src/module/admin/application/query/get-admin-auth-state/port';
import { type GetAdminAuthStateResult } from 'src/module/admin/application/query/get-admin-auth-state/query';
import { type IGetAdminByIdPort } from 'src/module/admin/application/query/get-admin-by-id/port';
import { type GetAdminByIdResult } from 'src/module/admin/application/query/get-admin-by-id/query';
import { type IGetAdminCredentialsByEmailPort } from 'src/module/admin/application/query/get-admin-credentials-by-email/port';
import { type GetAdminCredentialsByEmailResult } from 'src/module/admin/application/query/get-admin-credentials-by-email/query';
import { type IGetAdminSessionVersionPort } from 'src/module/admin/application/query/get-admin-session-version/port';
import { type GetAdminSessionVersionResult } from 'src/module/admin/application/query/get-admin-session-version/query';
import { admin } from 'src/module/admin/infrastructure/admin.schema';

/**
 * Implements the admin query ports on the primary connection with direct projection queries: selects
 * only each read-model's columns and maps rows straight to flat results, never through the
 * aggregate. Every port here feeds a write decision (login, refresh, session reconciliation) or a
 * read-your-own-writes lookup, so a replica's lag is not acceptable; lag-tolerant reads live in the
 * replica reader. Methods are ordered by expected call frequency.
 */
@Injectable()
export class AdminReaderAdapter
    implements IGetAdminAuthStatePort, IGetAdminCredentialsByEmailPort, IGetAdminByIdPort, IGetAdminSessionVersionPort
{
    /**
     * @param db The Drizzle client on the primary connection
     */
    constructor(@Inject(TOKEN_DATABASE_CLIENT) private readonly db: NodePgDatabase) {}

    /**
     * Reads an admin's public read-model by identifier.
     *
     * @param id The unique identifier of the target admin
     * @returns The admin projection, or null when no non-deleted admin exists
     */
    async getById(id: string): Promise<GetAdminByIdResult | null> {
        try {
            return (
                (
                    await this.db
                        .select({
                            id: admin.id,
                            email: admin.email,
                            name: admin.name,
                            role: admin.role,
                            isBanned: admin.isBanned,
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
     * Reads an admin's credentials by email.
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
}
