/**
 * @file user-reader.adapter.ts
 * @description Drizzle implementation of the user query ports that must read the primary.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TOKEN_DATABASE_CLIENT, translateConnectionFailure } from 'src/core/database';
import { type IGetFreshUserByIdPort } from 'src/module/user/application/query/get-fresh-user-by-id/port';
import { type IGetUserActivationRecipientPort } from 'src/module/user/application/query/get-user-activation-recipient/port';
import { type GetUserActivationRecipientResult } from 'src/module/user/application/query/get-user-activation-recipient/query';
import { type IGetUserByIdPort } from 'src/module/user/application/query/get-user-by-id/port';
import { type GetUserByIdResult } from 'src/module/user/application/query/get-user-by-id/query';
import { type IGetUserCredentialsByEmailPort } from 'src/module/user/application/query/get-user-credentials-by-email/port';
import { type GetUserCredentialsByEmailResult } from 'src/module/user/application/query/get-user-credentials-by-email/query';
import type { IGetUserEmailChangeNotificationRecipientPort } from 'src/module/user/application/query/get-user-email-change-notification-recipient/port';
import type { GetUserEmailChangeNotificationRecipientResult } from 'src/module/user/application/query/get-user-email-change-notification-recipient/query';
import type { IGetUserEmailConfirmationRecipientPort } from 'src/module/user/application/query/get-user-email-confirmation-recipient/port';
import type { GetUserEmailConfirmationRecipientResult } from 'src/module/user/application/query/get-user-email-confirmation-recipient/query';
import { type IGetUserNoticeRecipientPort } from 'src/module/user/application/query/get-user-notice-recipient/port';
import { type GetUserNoticeRecipientResult } from 'src/module/user/application/query/get-user-notice-recipient/query';
import { type IGetUserRefreshStatePort } from 'src/module/user/application/query/get-user-refresh-state/port';
import { type GetUserRefreshStateResult } from 'src/module/user/application/query/get-user-refresh-state/query';
import { type IGetUserSessionVersionPort } from 'src/module/user/application/query/get-user-session-version/port';
import { type GetUserSessionVersionResult } from 'src/module/user/application/query/get-user-session-version/query';
import type { IIsUserEmailInUsePort } from 'src/module/user/application/query/is-user-email-in-use/port';
import type { IsUserEmailInUseResult } from 'src/module/user/application/query/is-user-email-in-use/query';
import { emailChangeNotification, user } from 'src/module/user/infrastructure/user.schema';

/**
 * Implements the user query ports on the primary connection with direct projection queries: selects
 * only each read-model's columns and maps rows straight to flat results, never through the
 * aggregate. Every port here feeds a write decision (login, refresh, session reconciliation) or
 * populates the read cache or returns a post-mutation projection. Lag-tolerant reads live in the
 * replica reader.
 */
@Injectable()
export class UserReaderAdapter
    implements
        IIsUserEmailInUsePort,
        IGetUserActivationRecipientPort,
        IGetUserEmailChangeNotificationRecipientPort,
        IGetUserEmailConfirmationRecipientPort,
        IGetFreshUserByIdPort,
        IGetUserRefreshStatePort,
        IGetUserByIdPort,
        IGetUserCredentialsByEmailPort,
        IGetUserNoticeRecipientPort,
        IGetUserSessionVersionPort
{
    /**
     * Connects authoritative account reads to the primary database.
     *
     * @param database The Drizzle client on the primary connection
     */
    constructor(@Inject(TOKEN_DATABASE_CLIENT) private readonly database: NodePgDatabase) {}

    /**
     * Retrieves a non-deleted user's read-model by ID.
     *
     * @param id The unique identifier
     * @returns The user read-model, or null if not found
     */
    async getById(id: string): Promise<GetUserByIdResult | null> {
        try {
            return (
                (
                    await this.database
                        .select({
                            id: user.id,
                            email: user.email,
                            name: user.name,
                            permissions: user.permissions,
                            isBanned: user.isBanned,
                        })
                        .from(user)
                        .where(and(eq(user.id, id), isNull(user.deletedAt)))
                        .limit(1)
                )[0] ?? null
            );
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Retrieves credential fields for a non-deleted user by email.
     *
     * @param email The exact email address
     * @returns The minimal credential projection or null if not found
     */
    async getCredentialsByEmail(email: string): Promise<GetUserCredentialsByEmailResult | null> {
        try {
            return (
                (
                    await this.database
                        .select({
                            id: user.id,
                            password: user.password,
                            requiresActivation: sql<boolean>`${user.activationId} is not null`,
                            permissions: user.permissions,
                            isBanned: user.isBanned,
                            sessionVersion: user.sessionVersion,
                        })
                        .from(user)
                        .where(and(eq(user.email, email), isNull(user.deletedAt)))
                        .limit(1)
                )[0] ?? null
            );
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Reads the current details required to activate an eligible pending user.
     *
     * @param id The unique identifier of the target user
     * @param deliveryId The original activation delivery identity
     * @returns The activation details, or null when delivery is no longer allowed
     */
    async getActivationRecipient(id: string, deliveryId: string): Promise<GetUserActivationRecipientResult | null> {
        try {
            return ((
                await this.database
                    .select({
                        email: user.email,
                        name: user.name,
                        activationId: user.activationId,
                        activationExpiresAt: user.activationExpiresAt,
                        activationRevocationVersion: user.activationRevocationVersion,
                    })
                    .from(user)
                    .where(
                        and(
                            eq(user.id, id),
                            isNull(user.deletedAt),
                            eq(user.isBanned, false),
                            isNotNull(user.activationId),
                            isNotNull(user.activationExpiresAt),
                            isNotNull(user.activationRevocationVersion),
                            eq(user.activationId, deliveryId),
                            gt(user.activationExpiresAt, new Date()),
                            eq(user.activationRevocationVersion, user.revocationVersion),
                        ),
                    )
                    .limit(1)
            )[0] ?? null) as GetUserActivationRecipientResult | null;
        } catch (error) {
            throw translateConnectionFailure(error);
        }
    }

    /**
     * Reads the current recipient details for a user notice.
     *
     * @param id The unique identifier of the target user
     * @returns The notice recipient details, or null when no non-deleted user exists
     */
    async getNoticeRecipient(id: string): Promise<GetUserNoticeRecipientResult | null> {
        try {
            return (
                (
                    await this.database
                        .select({ email: user.email, name: user.name })
                        .from(user)
                        .where(and(eq(user.id, id), isNull(user.deletedAt)))
                        .limit(1)
                )[0] ?? null
            );
        } catch (error) {
            throw translateConnectionFailure(error);
        }
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
        try {
            return (
                (
                    await this.database
                        .select({ sessionVersion: user.sessionVersion })
                        .from(user)
                        .where(eq(user.id, id))
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
    async getRefreshState(id: string, tokenSessionVersion: number): Promise<GetUserRefreshStateResult | null> {
        try {
            return (
                (
                    await this.database
                        .select({
                            sessionVersion: user.sessionVersion,
                            permissions: user.permissions,
                        })
                        .from(user)
                        .where(
                            and(
                                eq(user.id, id),
                                isNull(user.deletedAt),
                                eq(user.isBanned, false),
                                isNull(user.activationId),
                                lte(user.revocationVersion, tokenSessionVersion),
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
    async isEmailInUse(email: string): Promise<IsUserEmailInUseResult> {
        try {
            return {
                isInUse:
                    (await this.database.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1))
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
    ): Promise<GetUserEmailConfirmationRecipientResult | null> {
        try {
            return ((
                await this.database
                    .select({
                        name: user.name,
                        pendingEmailRequestId: user.pendingEmailRequestId,
                        pendingEmail: user.pendingEmail,
                        pendingEmailExpiresAt: user.pendingEmailExpiresAt,
                        pendingEmailRevocationVersion: user.pendingEmailRevocationVersion,
                    })
                    .from(user)
                    .where(
                        and(
                            eq(user.id, id),
                            isNull(user.deletedAt),
                            eq(user.isBanned, false),
                            isNotNull(user.pendingEmailRequestId),
                            isNotNull(user.pendingEmail),
                            isNotNull(user.pendingEmailExpiresAt),
                            isNotNull(user.pendingEmailRevocationVersion),
                            eq(user.pendingEmailRequestId, deliveryId),
                            gt(user.pendingEmailExpiresAt, new Date()),
                            eq(user.pendingEmailRevocationVersion, user.revocationVersion),
                        ),
                    )
                    .limit(1)
            )[0] ?? null) as GetUserEmailConfirmationRecipientResult | null;
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
    ): Promise<GetUserEmailChangeNotificationRecipientResult | null> {
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
