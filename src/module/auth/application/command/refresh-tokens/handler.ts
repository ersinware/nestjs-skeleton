/**
 * @file handler.ts
 * @description Handles the RefreshTokensCommand: atomic session rotation with reuse detection and remediation.
 */

import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { randomUUID } from 'node:crypto';
import { TOKEN_TRANSACTION_PORT, type ITransactionPort } from 'src/core/database';
import { TOKEN_JOB_QUEUE_WRITER_PORT, type IJobQueueWriterPort } from 'src/core/job-queue';
import { TOKEN_AUDIT_PORT, type IAuditPort } from 'src/core/observability/audit';
import {
    ReplaySessionOutcome,
    RotateSessionOutcome,
    TOKEN_SESSION_PORT,
    type ISessionPort,
    type ReplaySessionResult,
    type RotateSessionResult,
} from 'src/core/security/session';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token';
import {
    TOKEN_IDENTITY_READER_PORT,
    type IIdentityReaderPort,
    type RefreshState,
} from 'src/module/auth/application/command/port/identity-reader.port';
import {
    RefreshTokensCommand,
    RefreshTokensRejectionMessage,
    type RefreshTokensResult,
} from 'src/module/auth/application/command/refresh-tokens/command';
import { AuthAuditAction } from 'src/module/auth/shared/auth-audit';
import { AdminSessionRevocationJobQueue } from 'src/shared/domain/admin';
import { PrincipalType } from 'src/shared/domain/principal';
import { UserSessionRevocationJobQueue } from 'src/shared/domain/user';
import {
    ExceptionKind,
    ResourceConflictException,
    ResourceConflictMessage,
    SystemException,
    UnauthenticatedException,
    UnauthenticatedMessage,
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
     * @throws {ResourceConflictException} When the request key conflicts or the token was already rotated within grace.
     * @throws {DependencyUnavailableException} When identity lookup, session rotation, job persistence, or audit persistence is unavailable.
     * @throws {SystemException} When a session outcome is unexpected
     */
    async execute(command: RefreshTokensCommand): Promise<RefreshTokensResult> {
        let payload;

        try {
            payload = await this.tokenPort.verifyRefreshTokenForReplay(command.refreshToken);
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                throw new UnauthenticatedException(UnauthenticatedMessage.DEFAULT, { cause: error });
            }

            throw error;
        }

        let sessionResult: ReplaySessionResult | RotateSessionResult = await this.sessionPort.findSessionRequestReplay(
                command.idempotencyRequest,
                payload.sub,
                payload.principalType,
            ),
            identity: RefreshState;

        switch (sessionResult.outcome) {
            case ReplaySessionOutcome.CONFLICT:
                throw new ResourceConflictException(ResourceConflictMessage.IDEMPOTENCY_KEY_CONFLICT);
            case ReplaySessionOutcome.REPLAY_UNAVAILABLE:
            case ReplaySessionOutcome.SESSION_UNAVAILABLE:
            case ReplaySessionOutcome.VERSION_SUPERSEDED:
                throw new UnauthenticatedException();
            case ReplaySessionOutcome.REPLAYED:
                identity = await this.getRefreshState(
                    payload.principalType,
                    payload.sub,
                    sessionResult.session.sessionVersion,
                );

                break;
            case ReplaySessionOutcome.NOT_FOUND: {
                if (payload.exp <= Math.floor(Date.now() / 1000)) {
                    throw new UnauthenticatedException();
                }

                identity = await this.getRefreshState(payload.principalType, payload.sub, payload.sessionVersion);
                sessionResult = await this.sessionPort.rotateSession(
                    command.idempotencyRequest,
                    payload.sub,
                    payload.jti,
                    {
                        principalType: payload.principalType,
                        sessionVersion: identity.sessionVersion,
                        sid: payload.sid,
                        sessionExpiresAt: payload.sessionExpiresAt,
                    },
                );

                switch (sessionResult.outcome) {
                    case ReplaySessionOutcome.CONFLICT:
                        throw new ResourceConflictException(ResourceConflictMessage.IDEMPOTENCY_KEY_CONFLICT);
                    case ReplaySessionOutcome.REPLAY_UNAVAILABLE:
                    case ReplaySessionOutcome.SESSION_UNAVAILABLE:
                    case ReplaySessionOutcome.VERSION_SUPERSEDED:
                        throw new UnauthenticatedException();
                    case ReplaySessionOutcome.REPLAYED:
                        // Mutation may find a competing winner after the initial replay lookup.
                        identity = await this.getRefreshState(
                            payload.principalType,
                            payload.sub,
                            sessionResult.session.sessionVersion,
                        );

                        break;
                    case RotateSessionOutcome.SESSION_CLOSED:
                    case RotateSessionOutcome.SESSION_UNAVAILABLE:
                    case RotateSessionOutcome.VERSION_SUPERSEDED:
                        throw new UnauthenticatedException();
                    case RotateSessionOutcome.CONCURRENT_REPLAY:
                        // Timing cannot prove legitimacy; preserve evidence without revoking sessions.
                        await this.auditPort.record({
                            action: AuthAuditAction.REFRESH_CONCURRENT_REPLAY,
                            targetId: payload.sub,
                        });

                        throw new ResourceConflictException(RefreshTokensRejectionMessage.CONCURRENT_REFRESH);
                    case RotateSessionOutcome.REUSE_DETECTED: {
                        const deliveryId = randomUUID();

                        // Commit reuse evidence and the revocation request before rejecting the credential.
                        await this.transactionPort.start(async () => {
                            await this.jobQueueWriterPort.enqueue([
                                {
                                    deliveryId,
                                    aggregateId: payload.sub,
                                    queueName: REFRESH_REUSE_QUEUE_BY_PRINCIPAL_TYPE[payload.principalType],
                                },
                            ]);
                            await this.auditPort.record({
                                action: AuthAuditAction.REFRESH_REUSE_DETECTED,
                                targetId: payload.sub,
                                detail: { deliveryId },
                            });
                        });

                        throw new UnauthenticatedException();
                    }
                    case RotateSessionOutcome.ROTATED:
                        break;
                    default:
                        this.rejectUnexpectedSessionResult(sessionResult);
                }

                break;
            }
            default:
                this.rejectUnexpectedSessionResult(sessionResult);
        }

        const { session } = sessionResult,
            tokenPayload = {
                sub: payload.sub,
                principalType: session.principalType,
                sid: session.sid,
                sessionExpiresAt: session.sessionExpiresAt,
                sessionVersion: session.sessionVersion,
            };

        return this.tokenPort.generateTokens(
            { ...tokenPayload, permissions: identity.permissions, exp: sessionResult.accessExpiresAt },
            { ...tokenPayload, jti: session.refreshTokenJti, exp: session.refreshExpiresAt },
        );
    }

    /**
     * Reads eligible refresh claims while keeping missing or revoked accounts unauthenticated.
     *
     * @param principalType Owning principal context.
     * @param principalId Account identifier.
     * @param sessionVersion Verified credential or winning replay version.
     * @returns Current claims for the eligible account.
     * @throws {UnauthenticatedException} When the account or supplied version is no longer eligible.
     * @throws {DependencyUnavailableException} When the identity store is unavailable.
     */
    private async getRefreshState(
        principalType: PrincipalType,
        principalId: string,
        sessionVersion: number,
    ): Promise<RefreshState> {
        try {
            return await this.identityReaderPort.getRefreshState(principalType, principalId, sessionVersion);
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.RESOURCE_NOT_FOUND)) {
                throw new UnauthenticatedException(UnauthenticatedMessage.DEFAULT, { cause: error });
            }

            throw error;
        }
    }

    /**
     * Rejects unsupported session decisions and requires exhaustive refresh outcome handling.
     *
     * @param sessionResult Unsupported session result used only for exhaustive type checking.
     * @returns Never returns because the decision violates the session contract.
     */
    private rejectUnexpectedSessionResult(sessionResult: never): never {
        void sessionResult;

        throw new SystemException('Refresh received an unexpected session outcome.', {
            context: { class: this.constructor.name, method: this.execute.name },
        });
    }
}
