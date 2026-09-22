/**
 * @file user-reader.adapter.ts
 * @description Drizzle implementation of the user query ports that must read the primary.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { TOKEN_DATABASE_CLIENT, translateConnectionFailure } from 'src/core/database';
import { type IGetUserAuthStatePort } from 'src/module/user/application/query/get-user-auth-state/port';
import { type GetUserAuthStateResult } from 'src/module/user/application/query/get-user-auth-state/query';
import { type IGetUserByIdPort } from 'src/module/user/application/query/get-user-by-id/port';
import { type GetUserByIdResult } from 'src/module/user/application/query/get-user-by-id/query';
import { type IGetUserCredentialsByEmailPort } from 'src/module/user/application/query/get-user-credentials-by-email/port';
import { type GetUserCredentialsByEmailResult } from 'src/module/user/application/query/get-user-credentials-by-email/query';
import { type IGetUserNoticeRecipientPort } from 'src/module/user/application/query/get-user-notice-recipient/port';
import { type GetUserNoticeRecipientResult } from 'src/module/user/application/query/get-user-notice-recipient/query';
import { type IGetUserSessionVersionPort } from 'src/module/user/application/query/get-user-session-version/port';
import { type GetUserSessionVersionResult } from 'src/module/user/application/query/get-user-session-version/query';
import { user } from 'src/module/user/infrastructure/user.schema';

/**
 * Implements the user query ports on the primary connection with direct projection queries: selects
 * only each read-model's columns and maps rows straight to flat results, never through the
 * aggregate. Every port here feeds a write decision (login, refresh, session reconciliation) or
 * populates the read cache, so a replica's lag is not acceptable; lag-tolerant reads live in the
 * replica reader.
 */
@Injectable()
export class UserReaderAdapter
    implements
        IGetUserAuthStatePort,
        IGetUserByIdPort,
        IGetUserCredentialsByEmailPort,
        IGetUserNoticeRecipientPort,
        IGetUserSessionVersionPort
{
    /**
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
     * Reads a user's ban status, session counters and permissions by ID.
     *
     * @param id The unique identifier
     * @returns The auth state, or null if not found
     */
    async getAuthState(id: string): Promise<GetUserAuthStateResult | null> {
        try {
            return (
                (
                    await this.database
                        .select({
                            isBanned: user.isBanned,
                            sessionVersion: user.sessionVersion,
                            revocationVersion: user.revocationVersion,
                            permissions: user.permissions,
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
}
