/**
 * @file handler.ts
 * @description Handles the RefreshTokensCommand: atomic session rotation with reuse detection and remediation.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { randomUUID } from 'node:crypto';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { TOKEN_JOB_QUEUE_WRITER_PORT, type IJobQueueWriterPort } from 'src/core/job-queue';
import { AuditAction, TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import { RotateOutcome, TOKEN_SESSION_PORT, type ISessionPort } from 'src/core/security/session';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import {
    TOKEN_IDENTITY_READER_PORT,
    type IIdentityReaderPort,
} from 'src/module/auth/application/command/port/identity-reader.port';
import {
    RefreshTokensCommand,
    RefreshTokensMessage,
    type RefreshTokensResult,
} from 'src/module/auth/application/command/refresh-tokens/command';
import { AdminSessionRevocationJobQueue } from 'src/shared/domain/admin';
import { PrincipalType } from 'src/shared/domain/principal';
import { UserSessionRevocationJobQueue } from 'src/shared/domain/user';
import {
    ExceptionKind,
    ResourceConflictException,
    SystemException,
    UnauthenticatedException,
    isExceptionOfKind,
} from 'src/shared/exception';

/**
 * The refresh-reuse queue owned by each principal context. Exhaustive over {@link PrincipalType}
 * so a new kind fails compilation here instead of routing remediation nowhere.
 */
const REFRESH_REUSE_QUEUE_BY_PRINCIPAL_TYPE = {
    [PrincipalType.USER]: UserSessionRevocationJobQueue.REFRESH_REUSE,
    [PrincipalType.ADMIN]: AdminSessionRevocationJobQueue.REFRESH_REUSE,
} as const satisfies Record<PrincipalType, string>;

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
     * @param jobQueueWriterPort The port used to persist the reuse-remediation job
     * @param transactionPort Commits the job and audit together
     * @param auditPort The port used to record refresh-reuse decisions
     */
    constructor(
        @Inject(TOKEN_TOKEN_PORT) private readonly tokenPort: ITokenPort,
        @Inject(TOKEN_IDENTITY_READER_PORT) private readonly identityReaderPort: IIdentityReaderPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_JOB_QUEUE_WRITER_PORT) private readonly jobQueueWriterPort: IJobQueueWriterPort,
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
    ) {}

    /**
     * Executes the refresh token command.
     *
     * @param command The refresh token command parameters
     * @returns The generated access and refresh tokens
     * @throws {UnauthenticatedException} When the token is invalid, the account is inactive, the session was superseded, or refresh-token reuse is detected.
     * @throws {ResourceConflictException} When the token was already rotated within grace; the client needs the latest token pair.
     * @throws {DependencyUnavailableException} When the session cache, job queue, or audit store is unreachable.
     */
    async execute(command: RefreshTokensCommand): Promise<RefreshTokensResult> {
        let payload;

        try {
            payload = await this.tokenPort.verifyRefreshToken(command.refreshToken);
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                throw new UnauthenticatedException();
            }

            throw error;
        }

        const { sub, principalType } = payload;

        let identity;
        try {
            identity = await this.identityReaderPort.getAuthState(principalType, sub);
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.RESOURCE_NOT_FOUND)) {
                throw new UnauthenticatedException();
            }

            throw error;
        }

        if (identity.isBanned) {
            throw new UnauthenticatedException();
        }

        // The DB is the authority. The floor is the last FULL revocation, not the current version:
        // a permission change advances the version alone, so the access tokens it retired are
        // refreshed here into ones carrying the new set, while a ban or password change moves the
        // floor and kills this refresh token too.
        if (payload.sessionVersion < identity.revocationVersion) {
            throw new UnauthenticatedException();
        }

        // The access token is minted from the freshly read permissions, never from the old token:
        // a refresh is exactly where a permission change reaches the client.
        const tokenPairWithSession = await this.tokenPort.refreshTokens(
                { id: sub, type: principalType, permissions: identity.permissions },
                identity.sessionVersion,
                { sid: payload.sid, sessionExpiresAt: payload.sessionExpiresAt },
            ),
            // The atomic rotation is both the single-use gate and the classifier: the grace
            // tombstone distinguishes replay within grace from post-window reuse, not concurrency from theft.
            outcome = await this.sessionPort.rotateSession(sub, payload.jti, tokenPairWithSession.session);

        if (outcome === RotateOutcome.ROTATED) {
            return { accessToken: tokenPairWithSession.accessToken, refreshToken: tokenPairWithSession.refreshToken };
        }

        if (outcome === RotateOutcome.SESSION_CLOSED) {
            throw new UnauthenticatedException();
        }

        if (outcome === RotateOutcome.CONCURRENT_REPLAY) {
            // Timing cannot prove a replay is benign; preserve evidence without revoking sessions.
            await this.auditPort.record({
                action: AuditAction.REFRESH_CONCURRENT_REPLAY,
                targetId: sub,
            });

            throw new ResourceConflictException(RefreshTokensMessage.CONCURRENT_REFRESH);
        }

        if (outcome !== RotateOutcome.REUSE_DETECTED) {
            return rejectUnhandledRotateOutcome(outcome);
        }

        // Commit the reuse evidence and revocation request before rejecting the credential.
        await this.transactionPort.run(async () => {
            await this.jobQueueWriterPort.enqueue([
                {
                    deliveryId: randomUUID(),
                    aggregateId: sub,
                    queueName: REFRESH_REUSE_QUEUE_BY_PRINCIPAL_TYPE[principalType],
                },
            ]);
            await this.auditPort.record({
                action: AuditAction.REFRESH_REUSE_DETECTED,
                targetId: sub,
            });
        });

        // No context: the reuse is audited above, and the response must stay indistinguishable from
        // every other rejected refresh.
        throw new UnauthenticatedException();
    }
}

/**
 * Rejects unhandled rotation outcomes before any reuse remediation.
 * @param outcome Outcome missing an explicit handler branch.
 * @returns Never returns normally.
 */
function rejectUnhandledRotateOutcome(outcome: never): never {
    throw new SystemException(`Unhandled session rotation outcome: ${String(outcome)}.`, {
        context: {
            class: RefreshTokensCommandHandler.name,
            method: rejectUnhandledRotateOutcome.name,
        },
    });
}
