/**
 * @file admin-reader.adapter.ts
 * @description Reads current admin projections from the primary database.
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
import { type IGetAdminInviteRecipientPort } from 'src/module/admin/application/query/get-admin-invite-recipient/port';
import { type GetAdminInviteRecipientResult } from 'src/module/admin/application/query/get-admin-invite-recipient/query';
import { type IGetAdminNoticeRecipientPort } from 'src/module/admin/application/query/get-admin-notice-recipient/port';
import { type GetAdminNoticeRecipientResult } from 'src/module/admin/application/query/get-admin-notice-recipient/query';
import { type IGetAdminSessionVersionPort } from 'src/module/admin/application/query/get-admin-session-version/port';
import { type GetAdminSessionVersionResult } from 'src/module/admin/application/query/get-admin-session-version/query';
import { admin } from 'src/module/admin/infrastructure/admin.schema';

/**
 * Implements admin queries that require current primary-database state.
 */
@Injectable()
export class AdminReaderAdapter
    implements
        IGetAdminAuthStatePort,
        IGetAdminCredentialsByEmailPort,
        IGetAdminByIdPort,
        IGetAdminInviteRecipientPort,
        IGetAdminNoticeRecipientPort,
        IGetAdminSessionVersionPort
{
    /**
     * Initializes the adapter with the primary database client.
     *
     * @param db The Drizzle client on the primary connection
     */
    constructor(@Inject(TOKEN_DATABASE_CLIENT) private readonly db: NodePgDatabase) {}

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
                    await this.db
                        .select({
                            id: admin.id,
                            email: admin.email,
                            name: admin.name,
                            permissions: admin.permissions,
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
                            permissions: admin.permissions,
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
     * Reads the current details required to invite an eligible pending admin.
     *
     * @param id The unique identifier of the target admin
     * @returns The invitation details, or null when the admin is no longer eligible
     */
    async getInviteRecipient(id: string): Promise<GetAdminInviteRecipientResult | null> {
        try {
            return (
                (
                    await this.db
                        .select({
                            email: admin.email,
                            name: admin.name,
                            revocationVersion: admin.revocationVersion,
                        })
                        .from(admin)
                        .where(
                            and(
                                eq(admin.id, id),
                                eq(admin.isBanned, false),
                                isNull(admin.password),
                                isNull(admin.deletedAt),
                            ),
                        )
                        .limit(1)
                )[0] ?? null
            );
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Reads the current recipient details for an admin notice.
     *
     * @param id The unique identifier of the target admin
     * @returns The notice recipient details, or null when no non-deleted admin exists
     */
    async getNoticeRecipient(id: string): Promise<GetAdminNoticeRecipientResult | null> {
        try {
            return (
                (
                    await this.db
                        .select({ email: admin.email, name: admin.name })
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
     * Reads an admin's authentication state.
     *
     * @param id The unique identifier of the target admin
     * @returns The auth state, or null when no non-deleted admin exists
     */
    async getAuthState(id: string): Promise<GetAdminAuthStateResult | null> {
        try {
            return (
                (
                    await this.db
                        .select({
                            isBanned: admin.isBanned,
                            sessionVersion: admin.sessionVersion,
                            revocationVersion: admin.revocationVersion,
                            permissions: admin.permissions,
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
}
