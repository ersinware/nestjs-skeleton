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
    ACCESS_TOKEN_TYPE,
    AccessTokenLifetimePolicy,
    REFRESH_TOKEN_TYPE,
    TOKEN_AUTH_ACCESS_TOKEN_PORT,
    TOKEN_AUTH_REFRESH_TOKEN_PORT,
    type AccessTokenPayload,
    type RefreshTokenPayload,
} from 'src/core/security/auth';
import { TOKEN_HASHING_PORT, type IHashingPort } from 'src/core/security/hashing';
import {
    ReplaySessionOutcome,
    RotateSessionOutcome,
    TOKEN_SESSION_PORT,
    type ISessionPort,
    type ReplaySessionResult,
    type RotateSessionResult,
    type SessionRequestIdentity,
} from 'src/core/security/session';
import { type ITokenPort } from 'src/core/security/token';
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
    isExceptionOfKind,
    ResourceConflictException,
    ResourceConflictMessage,
    SystemException,
    UnauthenticatedException,
    UnauthenticatedMessage,
} from 'src/shared/exception';
import { nowEpochSeconds } from 'src/shared/time';

/**
 * Separates session request fingerprints from other uses of the shared HMAC key.
 */
const SESSION_REQUEST_FINGERPRINT_CONTEXT = 'session:request-fingerprint';

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
     * @param accessTokenPort Signs rotated access credentials
     * @param refreshTokenPort Verifies presented refresh tokens and signs replacements
     * @param hashingPort Produces session request fingerprints
     * @param identityReaderPort Reads the principal's auth state
     * @param sessionPort Atomically rotates the refresh session
     * @param jobQueueWriterPort Persists the reuse-remediation job
     * @param transactionPort Commits the job and audit together
     * @param auditPort Records refresh-reuse decisions
     * @param accessTokenLifetimePolicy Bounds issued access credentials
     */
    constructor(
        @Inject(TOKEN_AUTH_ACCESS_TOKEN_PORT) private readonly accessTokenPort: ITokenPort<typeof ACCESS_TOKEN_TYPE>,
        @Inject(TOKEN_AUTH_REFRESH_TOKEN_PORT) private readonly refreshTokenPort: ITokenPort<typeof REFRESH_TOKEN_TYPE>,
        @Inject(TOKEN_HASHING_PORT) private readonly hashingPort: IHashingPort,
        @Inject(TOKEN_IDENTITY_READER_PORT) private readonly identityReaderPort: IIdentityReaderPort,
        @Inject(TOKEN_SESSION_PORT) private readonly sessionPort: ISessionPort,
        @Inject(TOKEN_JOB_QUEUE_WRITER_PORT) private readonly jobQueueWriterPort: IJobQueueWriterPort,
        @Inject(TOKEN_TRANSACTION_PORT) private readonly transactionPort: ITransactionPort,
        @Inject(TOKEN_AUDIT_PORT) private readonly auditPort: IAuditPort,
        private readonly accessTokenLifetimePolicy: AccessTokenLifetimePolicy,
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
        let payload: RefreshTokenPayload;

        try {
            payload = await this.refreshTokenPort.verify<RefreshTokenPayload>(
                command.refreshToken,
                REFRESH_TOKEN_TYPE,
                { ignoreExpiration: true },
            );
        } catch (error) {
            if (isExceptionOfKind(error, ExceptionKind.UNAUTHENTICATED)) {
                throw new UnauthenticatedException(UnauthenticatedMessage.DEFAULT, { cause: error });
            }

            throw error;
        }

        const now = nowEpochSeconds();

        if (payload.sessionExpiresAt <= now) {
            throw new UnauthenticatedException();
        }

        const requestIdentity: SessionRequestIdentity = {
            key: command.idempotencyRequest.key,
            fingerprint: this.hashingPort.hmacSha256(
                SESSION_REQUEST_FINGERPRINT_CONTEXT,
                command.idempotencyRequest.canonicalValue,
            ),
        };

        let sessionResult: ReplaySessionResult | RotateSessionResult = await this.sessionPort.findSessionRequestReplay(
                requestIdentity,
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
                if (payload.exp <= now) {
                    throw new UnauthenticatedException();
                }

                identity = await this.getRefreshState(payload.principalType, payload.sub, payload.sessionVersion);
                sessionResult = await this.sessionPort.rotateSession(requestIdentity, payload.sub, payload.jti, {
                    principalType: payload.principalType,
                    sessionVersion: identity.sessionVersion,
                    sid: payload.sid,
                    sessionExpiresAt: payload.sessionExpiresAt,
                });

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
            [accessToken, refreshToken] = await Promise.all([
                this.accessTokenPort.sign<AccessTokenPayload>(ACCESS_TOKEN_TYPE, {
                    exp: this.accessTokenLifetimePolicy.getAccessExpiresAt(session.refreshExpiresAt),
                    sub: payload.sub,
                    sid: session.sid,
                    principalType: session.principalType,
                    permissions: identity.permissions,
                    sessionVersion: session.sessionVersion,
                }),
                this.refreshTokenPort.sign<RefreshTokenPayload>(REFRESH_TOKEN_TYPE, {
                    sid: session.sid,
                    sessionExpiresAt: session.sessionExpiresAt,
                    exp: session.refreshExpiresAt,
                    sub: payload.sub,
                    principalType: session.principalType,
                    jti: session.refreshCredentialId,
                    sessionVersion: session.sessionVersion,
                }),
            ]);

        return { accessToken, refreshToken };
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
