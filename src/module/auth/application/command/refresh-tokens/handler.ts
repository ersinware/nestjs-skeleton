/**
 * @file handler.ts
 * @description Handles the RefreshTokenCommand by validating the existing refresh token, checking account active status, managing session lifecycle, and generating a new token pair.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_EVENT_BUS_PORT, type IEventBusPort } from 'src/core/event-bus';
import {
    ResourceConflictException,
    ResourceConflictType,
    ResourceNotFoundException,
    ServiceUnavailableException,
    ServiceUnavailableType,
    UnauthenticatedException,
    UnauthenticatedType,
} from 'src/core/exception';
import {
    AuditLogAction,
    AuditLogAuthReason,
    AuditLogPayload,
    LogPayload,
    TOKEN_LOGGER_PORT,
    type ILoggerPort,
} from 'src/core/observability/logger';
import { RotateOutcome, TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { AuthTokenType, TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import {
    TOKEN_ADMIN_IDENTITY_READER_PORT,
    type IAdminIdentityReaderPort,
} from 'src/module/auth/application/command/port/admin-identity-reader.port';
import {
    TOKEN_USER_IDENTITY_READER_PORT,
    type IUserIdentityReaderPort,
} from 'src/module/auth/application/command/port/user-identity-reader.port';
import {
    RefreshTokensCommand,
    type RefreshTokensResult,
} from 'src/module/auth/application/command/refresh-tokens/command';
import { AdminIntegrationEvent } from 'src/shared/domain/admin';
import { UserIntegrationEvent, UserRole } from 'src/shared/domain/user';
import { uuidv7 } from 'uuidv7';

/**
 * Handles the RefreshTokenCommand.
 * Verifies the refresh token, revokes the old session to prevent reuse, and issues a new session pair.
 */
@CommandHandler(RefreshTokensCommand)
export class RefreshTokensCommandHandler implements ICommandHandler<RefreshTokensCommand> {
    constructor(
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_USER_IDENTITY_READER_PORT) private readonly userIdentityReaderPort: IUserIdentityReaderPort,
        @Inject(TOKEN_ADMIN_IDENTITY_READER_PORT)
        private readonly adminIdentityReaderPort: IAdminIdentityReaderPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_EVENT_BUS_PORT) private readonly eventBusPort: IEventBusPort,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
    ) {}

    /**
     * Executes the refresh token command.
     *
     * @param command The refresh token command parameters
     * @returns The generated access and refresh tokens
     * @throws {UnauthenticatedException} When the token is invalid, the account is inactive, the session was superseded, or refresh-token reuse is detected.
     * @throws {ResourceConflictException} When a concurrent refresh already rotated the session (benign — the client should retry with its latest token pair).
     * @throws {ServiceUnavailableException} When the session cache is unreachable while rotating the session or revoking the family.
     */
    async execute(command: RefreshTokensCommand): Promise<RefreshTokensResult> {
        let payload;

        try {
            payload = await this.tokenPort.verifyRefreshToken(command.refreshToken);
        } catch {
            throw new UnauthenticatedException();
        }

        if (payload.type !== AuthTokenType.REFRESH) {
            throw new UnauthenticatedException();
        }

        const role = payload.role,
            sub = payload.sub;

        let identity;
        try {
            identity =
                role === UserRole.USER
                    ? await this.userIdentityReaderPort.getAuthState(sub)
                    : await this.adminIdentityReaderPort.getAuthState(sub);
        } catch (error) {
            if (error instanceof ResourceNotFoundException) {
                this.throwUnauthenticatedException(
                    AuditLogAction.REFRESH_FAILED,
                    AuditLogAuthReason.ACCOUNT_NOT_FOUND,
                    sub,
                    role,
                );
            }

            throw error;
        }

        if (identity.isBanned) {
            this.throwUnauthenticatedException(
                AuditLogAction.REFRESH_FAILED,
                AuditLogAuthReason.INACTIVE_ACCOUNT,
                sub,
                role,
            );
        }

        // Version is read from the DB (the authority), so a ban/password-change/delete that advanced
        // the version rejects the refresh before it can mint a fresh token.
        if (payload.version < identity.version) {
            this.throwUnauthenticatedException(
                AuditLogAction.REFRESH_FAILED,
                AuditLogAuthReason.SESSION_REVOKED,
                sub,
                role,
            );
        }

        const tokens = await this.tokenPort.generateTokens(role, sub, identity.version);

        // Single atomic rotation is both the single-use gate and the classifier (see RotateOutcome). The
        // old session's grace tombstone lets a lost concurrent-refresh race be told apart from a token
        // replayed after that window — the refresh-token reuse signal (RFC 9700) — so no separate pre-read
        // of the session is needed.
        let outcome: RotateOutcome;
        try {
            outcome = await this.sessionPort.rotateSession(sub, payload.jti, tokens.jti);
        } catch (error) {
            throw new ServiceUnavailableException(ServiceUnavailableType.DEFAULT, { cause: error });
        }

        if (outcome === RotateOutcome.ROTATED) {
            return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
        }

        if (outcome === RotateOutcome.CONCURRENT_REPLAY) {
            // A legitimate duplicate/concurrent refresh lost the race. Benign — reject only this request
            // with a 409 and leave the session family untouched. No audit log: this is not an attack.
            throw new ResourceConflictException(ResourceConflictType.CONCURRENT_REFRESH);
        }

        // RotateOutcome.REUSE_DETECTED — per the BCP, revoke the entire refresh family so a stolen token
        // cannot keep minting sessions. This immediate Redis eviction is the fast path; the follow-up
        // (a cross-module session-version bump that also kills outstanding access tokens, plus a security
        // email) is driven by the reuse integration event emitted below.
        try {
            await this.sessionPort.closeAllSessions(sub);
        } catch (error) {
            throw new ServiceUnavailableException(ServiceUnavailableType.DEFAULT, { cause: error });
        }

        // TODO
        // The owning module (user or admin) can only be reached asynchronously (§5 forbids cross-module
        // transactions), so the trigger is emitted on the in-process bus. Auth raises no aggregate of its
        // own, so the event is dispatched here rather than from a writer adapter. Fire-and-forget: the
        // sessions are already evicted and the caller must still get the 401 below, so a failing listener
        // must not turn this into a 503. Until the outbox returns there is no delivery guarantee behind
        // it, so a rejected dispatch is logged rather than swallowed.
        this.eventBusPort
            .emitAsync(
                role === UserRole.USER
                    ? UserIntegrationEvent.REFRESH_REUSE_DETECTED
                    : AdminIntegrationEvent.REFRESH_REUSE_DETECTED,
                { aggregateId: sub, eventId: uuidv7() },
            )
            .catch((error: unknown) =>
                this.loggerPort.error(
                    new LogPayload({
                        class: RefreshTokensCommandHandler.name,
                        method: this.execute.name,
                        error,
                        sub,
                        role,
                    }),
                ),
            );

        this.throwUnauthenticatedException(
            AuditLogAction.REFRESH_REUSE_DETECTED,
            AuditLogAuthReason.SESSION_REUSE,
            sub,
            role,
        );
    }

    /**
     * Throws an UnauthenticatedException with a properly formatted audit log payload.
     */
    private throwUnauthenticatedException(
        action: AuditLogAction,
        reason?: AuditLogAuthReason,
        sub?: string,
        role?: string,
    ): never {
        throw new UnauthenticatedException(UnauthenticatedType.DEFAULT, {
            cause: new AuditLogPayload({
                class: this.constructor.name,
                method: this.execute.name,
                action,
                reason,
                sub,
                role,
            }),
        });
    }
}
