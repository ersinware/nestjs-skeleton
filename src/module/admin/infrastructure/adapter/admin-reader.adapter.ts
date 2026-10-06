/**
 * @file admin-reader.adapter.ts
 * @description Reads current admin projections from the primary database.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TOKEN_DATABASE_CLIENT, translateConnectionFailure } from 'src/core/database';
import { type IGetAdminCredentialsByEmailPort } from 'src/module/admin/application/query/get-admin-credentials-by-email/port';
import { type GetAdminCredentialsByEmailResult } from 'src/module/admin/application/query/get-admin-credentials-by-email/query';
import type { IGetAdminEmailChangeNotificationRecipientPort } from 'src/module/admin/application/query/get-admin-email-change-notification-recipient/port';
import type { GetAdminEmailChangeNotificationRecipientResult } from 'src/module/admin/application/query/get-admin-email-change-notification-recipient/query';
import type { IGetAdminEmailConfirmationRecipientPort } from 'src/module/admin/application/query/get-admin-email-confirmation-recipient/port';
import type { GetAdminEmailConfirmationRecipientResult } from 'src/module/admin/application/query/get-admin-email-confirmation-recipient/query';
import { type IGetAdminInviteRecipientPort } from 'src/module/admin/application/query/get-admin-invite-recipient/port';
import { type GetAdminInviteRecipientResult } from 'src/module/admin/application/query/get-admin-invite-recipient/query';
import { type IGetAdminNoticeRecipientPort } from 'src/module/admin/application/query/get-admin-notice-recipient/port';
import { type GetAdminNoticeRecipientResult } from 'src/module/admin/application/query/get-admin-notice-recipient/query';
import { type IGetAdminRefreshStatePort } from 'src/module/admin/application/query/get-admin-refresh-state/port';
import { type GetAdminRefreshStateResult } from 'src/module/admin/application/query/get-admin-refresh-state/query';
import { type IGetAdminSessionVersionPort } from 'src/module/admin/application/query/get-admin-session-version/port';
import { type GetAdminSessionVersionResult } from 'src/module/admin/application/query/get-admin-session-version/query';
import { type IGetFreshAdminByIdPort } from 'src/module/admin/application/query/get-fresh-admin-by-id/port';
import { type GetFreshAdminByIdResult } from 'src/module/admin/application/query/get-fresh-admin-by-id/query';
import type { IIsAdminEmailInUsePort } from 'src/module/admin/application/query/is-admin-email-in-use/port';
import type { IsAdminEmailInUseResult } from 'src/module/admin/application/query/is-admin-email-in-use/query';
import { admin, emailChangeNotification } from 'src/module/admin/infrastructure/admin.schema';

/**
 * Implements admin queries that require current primary-database state.
 */
@Injectable()
export class AdminReaderAdapter
    implements
        IIsAdminEmailInUsePort,
        IGetAdminEmailChangeNotificationRecipientPort,
        IGetAdminEmailConfirmationRecipientPort,
        IGetAdminRefreshStatePort,
        IGetAdminCredentialsByEmailPort,
        IGetFreshAdminByIdPort,
        IGetAdminInviteRecipientPort,
        IGetAdminNoticeRecipientPort,
        IGetAdminSessionVersionPort
{
    /**
     * Initializes the adapter with the primary database client.
     *
     * @param database The Drizzle client on the primary connection
     */
    constructor(@Inject(TOKEN_DATABASE_CLIENT) private readonly database: NodePgDatabase) {}

    /**
     * Reads an admin projection by identifier.
     *
     * @param id The unique identifier of the target admin
     * @returns The admin projection, or null when no non-deleted admin exists
     */
    async getById(id: string): Promise<GetFreshAdminByIdResult | null> {
        try {
            return (
                (
                    await this.database
                        .select({
                            id: admin.id,
                            email: admin.email,
                            name: admin.name,
                            avatarKey: admin.avatarKey,
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
     * Reads an admin's credentials by email.
     *
     * @param email The exact email address to look up
     * @returns The credentials, or null when no non-deleted admin exists
     */
    async getCredentialsByEmail(email: string): Promise<GetAdminCredentialsByEmailResult | null> {
        try {
            return (
                (
                    await this.database
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
     * @param deliveryId The original invitation delivery identity
     * @returns The invitation details, or null when delivery is no longer allowed
     */
    async getInviteRecipient(id: string, deliveryId: string): Promise<GetAdminInviteRecipientResult | null> {
        try {
            return ((
                await this.database
                    .select({
                        email: admin.email,
                        name: admin.name,
                        inviteId: admin.inviteId,
                        inviteExpiresAt: admin.inviteExpiresAt,
                        inviteRevocationVersion: admin.inviteRevocationVersion,
                    })
                    .from(admin)
                    .where(
                        and(
                            eq(admin.id, id),
                            isNull(admin.deletedAt),
                            eq(admin.isBanned, false),
                            isNull(admin.password),
                            isNotNull(admin.inviteId),
                            isNotNull(admin.inviteExpiresAt),
                            isNotNull(admin.inviteRevocationVersion),
                            eq(admin.inviteId, deliveryId),
                            gt(admin.inviteExpiresAt, new Date()),
                            eq(admin.inviteRevocationVersion, admin.revocationVersion),
                        ),
                    )
                    .limit(1)
            )[0] ?? null) as GetAdminInviteRecipientResult | null;
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
                    await this.database
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
                    await this.database
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
     * Reads current claims only when the account and token version permit refresh.
     *
     * @param id The account identifier
     * @param tokenSessionVersion The verified refresh token's session version
     * @returns Current token claims, or null when refresh is not allowed
     */
    async getRefreshState(id: string, tokenSessionVersion: number): Promise<GetAdminRefreshStateResult | null> {
        try {
            return (
                (
                    await this.database
                        .select({
                            sessionVersion: admin.sessionVersion,
                            permissions: admin.permissions,
                        })
                        .from(admin)
                        .where(
                            and(
                                eq(admin.id, id),
                                isNull(admin.deletedAt),
                                eq(admin.isBanned, false),
                                lte(admin.revocationVersion, tokenSessionVersion),
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
     * Checks the same address scope as the unique constraint, including deleted accounts.
     *
     * @param email Target address to check
     * @returns Result indicating whether the address is already held
     */
    async isEmailInUse(email: string): Promise<IsAdminEmailInUseResult> {
        try {
            return {
                isInUse:
                    (await this.database.select({ id: admin.id }).from(admin).where(eq(admin.email, email)).limit(1))
                        .length > 0,
            };
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Reads pending metadata only for an eligible account.
     *
     * @param id Target account identifier
     * @param deliveryId Request identity assigned to the delivery job
     * @returns Recipient metadata, or null when delivery is no longer allowed
     */
    async getEmailConfirmationRecipient(
        id: string,
        deliveryId: string,
    ): Promise<GetAdminEmailConfirmationRecipientResult | null> {
        try {
            return ((
                await this.database
                    .select({
                        name: admin.name,
                        pendingEmailRequestId: admin.pendingEmailRequestId,
                        pendingEmail: admin.pendingEmail,
                        pendingEmailExpiresAt: admin.pendingEmailExpiresAt,
                        pendingEmailRevocationVersion: admin.pendingEmailRevocationVersion,
                    })
                    .from(admin)
                    .where(
                        and(
                            eq(admin.id, id),
                            isNull(admin.deletedAt),
                            eq(admin.isBanned, false),
                            isNotNull(admin.password),
                            isNotNull(admin.pendingEmailRequestId),
                            isNotNull(admin.pendingEmail),
                            isNotNull(admin.pendingEmailExpiresAt),
                            isNotNull(admin.pendingEmailRevocationVersion),
                            eq(admin.pendingEmailRequestId, deliveryId),
                            gt(admin.pendingEmailExpiresAt, new Date()),
                            eq(admin.pendingEmailRevocationVersion, admin.revocationVersion),
                        ),
                    )
                    .limit(1)
            )[0] ?? null) as GetAdminEmailConfirmationRecipientResult | null;
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Reads a committed old-address recipient by notification identity.
     *
     * @param id Notification delivery identity
     * @returns Stored old address and change time, or null
     */
    async getEmailChangeNotificationRecipient(
        id: string,
    ): Promise<GetAdminEmailChangeNotificationRecipientResult | null> {
        try {
            return (
                (
                    await this.database
                        .select({
                            previousEmail: emailChangeNotification.previousEmail,
                            createdAt: emailChangeNotification.createdAt,
                        })
                        .from(emailChangeNotification)
                        .where(eq(emailChangeNotification.id, id))
                        .limit(1)
                )[0] ?? null
            );
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }
}
