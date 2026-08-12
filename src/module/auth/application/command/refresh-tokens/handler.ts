/**
 * @file handler.ts
 * @description Handles the RefreshTokensCommand: atomic session rotation with reuse detection and remediation.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { TOKEN_EVENT_PUBLISHER_PORT, type IEventPublisherPort } from 'src/core/event-bus';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { RotateOutcome, TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import {
    IdentityRealm,
    TOKEN_IDENTITY_READER_PORT,
    realmOfRole,
    type IIdentityReaderPort,
} from 'src/module/auth/application/command/port/identity-reader.port';
import {
    RefreshTokensCommand,
    RefreshTokensMessage,
    type RefreshTokensResult,
} from 'src/module/auth/application/command/refresh-tokens/command';
import { AdminIntegrationEvent } from 'src/shared/domain/admin';
import { UserIntegrationEvent } from 'src/shared/domain/user';
import {
    ExceptionKind,
    ResourceConflictException,
    UnauthenticatedException,
    isExceptionOfKind,
} from 'src/shared/exception';
import { uuidv7 } from 'uuidv7';

/**
 * The reuse integration event each realm's owning module listens for. Exhaustive over
 * {@link IdentityRealm} (a new realm fails compilation here) so the remediation cannot silently
 * route to the wrong module.
 */
const REFRESH_REUSE_EVENT_BY_REALM = {
    [IdentityRealm.USER]: UserIntegrationEvent.REFRESH_REUSE_DETECTED,
    [IdentityRealm.ADMIN]: AdminIntegrationEvent.REFRESH_REUSE_DETECTED,
} as const satisfies Record<IdentityRealm, string>;

/**
 * Handler for the RefreshTokensCommand.
 * Verifies the token and the account's auth state, atomically rotates the session, and reacts to
 * the rotation outcome — including full-family revocation on detected reuse.
 */
@CommandHandler(RefreshTokensCommand)
export class RefreshTokensCommandHandler implements ICommandHandler<RefreshTokensCommand, RefreshTokensResult> {
    /**
     * Initializes the handler with the required ports.
     *
     * @param tokenPort The port used to verify the old and generate the new token pair
     * @param identityReaderPort The port used to read the principal's auth state
     * @param sessionPort The port used to atomically rotate the refresh session
     * @param eventPublisherPort The port used to publish the reuse-detection event
     * @param auditPort The port used to record refresh-reuse decisions
     */
    constructor(
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_IDENTITY_READER_PORT) private readonly identityReaderPort: IIdentityReaderPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_EVENT_PUBLISHER_PORT) private readonly eventPublisherPort: IEventPublisherPort,
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

        const role = payload.role,
            sub = payload.sub,
            realm = realmOfRole(role);

        let identity;
        try {
            identity = await this.identityReaderPort.getAuthState(realm, sub);
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.RESOURCE_NOT_FOUND)) {
                throw new UnauthenticatedException();
            }

            throw error;
        }

        if (identity.isBanned) {
            throw new UnauthenticatedException();
        }

        // The DB is the authority, so a mutation that advanced the version rejects the refresh
        // before it can mint a fresh token.
        if (payload.sessionVersion < identity.sessionVersion) {
            throw new UnauthenticatedException();
        }

        // Heals any drift the best-effort bumps left in the store and renews the key's TTL for the
        // fail-closed guard. Uncaught — the rotation below needs the same store anyway.
        await this.sessionPort.setVersion(sub, identity.sessionVersion);

        const tokens = await this.tokenPort.generateTokens(role, sub, identity.sessionVersion),
            // The atomic rotation is both the single-use gate and the classifier: the grace
            // tombstone tells a lost concurrent-refresh race apart from post-window reuse (RFC 9700).
            outcome = await this.sessionPort.rotateSession(sub, payload.jti, tokens.refreshTokenJti);

        if (outcome === RotateOutcome.ROTATED) {
            return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
        }

        if (outcome === RotateOutcome.CONCURRENT_REPLAY) {
            // A duplicate refresh lost the race — benign. 409 for this request only; no audit.
            throw new ResourceConflictException(RefreshTokensMessage.CONCURRENT_REFRESH);
        }

        // RotateOutcome.REUSE_DETECTED. Recorded FIRST: everything below can fail, and only this
        // handler can tell a replayed refresh token apart from any other 401 — left to the filter,
        // the signal would be filed as one more expired token.
        this.auditPort.record({
            action: AuditAction.REFRESH_REUSE_DETECTED,
            targetId: sub,
        });

        // Revoke the whole refresh family (RFC 9700) so a stolen token cannot keep minting sessions.
        // The version bump that also kills outstanding access tokens is driven by the event below.
        await this.sessionPort.closeAllSessions(sub);

        // The owning module is reachable only asynchronously; auth has no aggregate, so the event is
        // emitted here. Fire-and-forget: the family is already revoked and the caller must still get
        // the 401 — a failing listener must not turn this into a 503.
        this.eventPublisherPort
            .emitAsync(REFRESH_REUSE_EVENT_BY_REALM[realm], { aggregateId: sub, eventId: uuidv7() })
            .catch(() => {});

        // No context: the reuse is audited above, and the response must stay indistinguishable from
        // every other rejected refresh.
        throw new UnauthenticatedException();
    }
}
