/**
 * @file handler.ts
 * @description Handles the RefreshTokenCommand by validating the existing refresh token, checking account active status, managing session lifecycle, and generating a new token pair.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_EVENT_BUS_PORT, type IEventBusPort } from 'src/core/event-bus';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { RotateOutcome, TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { AuthTokenType, TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import { AuthRejectionReason } from 'src/module/auth/application/command/auth-rejection-reason.enum';
import {
    IdentityRealm,
    TOKEN_IDENTITY_READER_PORT,
    type IIdentityReaderPort,
} from 'src/module/auth/application/command/port/identity-reader.port';
import {
    RefreshTokensCommand,
    RefreshTokensMessage,
    type RefreshTokensResult,
} from 'src/module/auth/application/command/refresh-tokens/command';
import { AdminIntegrationEvent } from 'src/shared/domain/admin';
import { UserIntegrationEvent, UserRole } from 'src/shared/domain/user';
import {
    DependencyUnavailableException,
    DependencyUnavailableMessage,
    ExceptionKind,
    ResourceConflictException,
    UnauthenticatedException,
    isExceptionOfKind,
} from 'src/shared/exception';
import { uuidv7 } from 'uuidv7';

/**
 * Handles the RefreshTokenCommand.
 * Verifies the refresh token, revokes the old session to prevent reuse, and issues a new session pair.
 */
@CommandHandler(RefreshTokensCommand)
export class RefreshTokensCommandHandler implements ICommandHandler<RefreshTokensCommand> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param tokenPort The port used to verify the old and generate the new token pair
     * @param identityReaderPort The port used to read the principal's auth state
     * @param sessionPort The port used to atomically rotate the refresh session
     * @param eventBusPort The port used to publish the reuse-detection event
     * @param auditPort The port used to record refresh-reuse decisions
     */
    constructor(
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_IDENTITY_READER_PORT) private readonly identityReaderPort: IIdentityReaderPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_EVENT_BUS_PORT) private readonly eventBusPort: IEventBusPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the refresh token command.
     *
     * @param command The refresh token command parameters
     * @returns The generated access and refresh tokens
     * @throws {UnauthenticatedException} When the token is invalid, the account is inactive, the session was superseded, or refresh-token reuse is detected.
     * @throws {ResourceConflictException} When a concurrent refresh already rotated the session (benign — the client should retry with its latest token pair).
     * @throws {DependencyUnavailableException} When the session cache is unreachable while rotating the session or revoking the family.
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
            identity = await this.identityReaderPort.getAuthState(
                role === UserRole.USER ? IdentityRealm.USER : IdentityRealm.ADMIN,
                sub,
            );
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.RESOURCE_NOT_FOUND)) {
                throw new UnauthenticatedException();
            }

            throw error;
        }

        // The three rejections below leave no audit record on purpose: each is the CONSEQUENCE of an
        // act that is itself audited where it happened — the deletion, the ban, or whatever advanced
        // the version. Recording the refusal too would file the same event twice under a weaker name,
        // and the client's only correct response to all three is to authenticate again.
        if (identity.isBanned) {
            throw new UnauthenticatedException();
        }

        // Version is read from the DB (the authority), so a ban/password-change/delete that advanced
        // the version rejects the refresh before it can mint a fresh token.
        if (payload.version < identity.version) {
            throw new UnauthenticatedException();
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
            throw new DependencyUnavailableException(DependencyUnavailableMessage.DEFAULT, { cause: error });
        }

        if (outcome === RotateOutcome.ROTATED) {
            return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
        }

        if (outcome === RotateOutcome.CONCURRENT_REPLAY) {
            // A legitimate duplicate/concurrent refresh lost the race. Benign — reject only this request
            // with a 409 and leave the session family untouched. No audit log: this is not an attack.
            throw new ResourceConflictException(RefreshTokensMessage.CONCURRENT_REFRESH);
        }

        // RotateOutcome.REUSE_DETECTED. The record is written FIRST, before any of the remediation
        // below: the fact is already established by the rotation, and everything that follows can
        // fail — an unreachable Redis would turn this into a 503 and lose the most serious signal the
        // system can raise, exactly when an attacker would most like it lost.
        //
        // This handler is also the only place that can tell a replayed refresh token apart from any
        // other 401: the distinction lives in RotateOutcome and never leaves this method. Left to the
        // filter, which sees only a status code, the most serious signal here would be filed as one
        // more expired token.
        this.auditPort.record({
            action: AuditAction.REFRESH_REUSE_DETECTED,
            reason: AuthRejectionReason.SESSION_REUSE,
            targetId: sub,
        });

        // Per the BCP, revoke the entire refresh family so a stolen token
        // cannot keep minting sessions. This immediate Redis eviction is the fast path; the follow-up
        // (a cross-module session-version bump that also kills outstanding access tokens, plus a security
        // email) is driven by the reuse integration event emitted below.
        try {
            await this.sessionPort.closeAllSessions(sub);
        } catch (error) {
            throw new DependencyUnavailableException(DependencyUnavailableMessage.DEFAULT, { cause: error });
        }

        // The owning module (user or admin) can only be reached asynchronously (§5 forbids cross-module
        // transactions), so the trigger is emitted on the in-process bus. Auth raises no aggregate of its
        // own, so the event is dispatched here rather than from a writer adapter. Fire-and-forget: the
        // sessions are already evicted and the caller must still get the 401 below, so a failing listener
        // must not turn this into a 503. A rejected dispatch is swallowed — the family is already
        // revoked above; the catch only stops an unhandled rejection.
        this.eventBusPort
            .emitAsync(
                role === UserRole.USER
                    ? UserIntegrationEvent.REFRESH_REUSE_DETECTED
                    : AdminIntegrationEvent.REFRESH_REUSE_DETECTED,
                { aggregateId: sub, eventId: uuidv7() },
            )
            .catch(() => {});

        // No context: the event has an audit record of its own, and the response must stay
        // indistinguishable from every other rejected refresh so a probe learns nothing from it.
        throw new UnauthenticatedException();
    }
}
