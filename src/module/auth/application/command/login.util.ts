/**
 * @file login.util.ts
 * @description Shared user/admin login with retained-session replay before password preparation.
 */

import type { IdempotencyRequest } from 'src/core/idempotency';
import { type IAuditPort } from 'src/core/observability/audit';
import {
    ACCESS_TOKEN_TYPE,
    REFRESH_TOKEN_TYPE,
    type AccessTokenLifetimePolicy,
    type AccessTokenPayload,
    type RefreshTokenPayload,
} from 'src/core/security/auth';
import type { IHashingPort } from 'src/core/security/hashing';
import {
    OpenSessionOutcome,
    ReplaySessionOutcome,
    SessionOutcome,
    type ISessionPort,
    type OpenSessionResult,
    type ReplaySessionResult,
    type SessionRequestIdentity,
} from 'src/core/security/session';
import type { ITokenPort } from 'src/core/security/token';
import type { IIdentityReaderPort } from 'src/module/auth/application/command/port/identity-reader.port';
import { AuthAuditAction } from 'src/module/auth/shared/auth-audit';
import type { PrincipalType } from 'src/shared/domain/principal';
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
 * Separates session request fingerprints from other uses of the shared HMAC key.
 */
const SESSION_REQUEST_FINGERPRINT_CONTEXT = 'session:request-fingerprint';

/**
 * Internal refusal reasons recorded in audit; clients receive the uniform credentials message.
 */
enum AuthRejectionReason {
    /**
     * No account matches the email within the requested principal context.
     */
    ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',

    /**
     * The account is banned from authenticating.
     */
    INACTIVE_ACCOUNT = 'INACTIVE_ACCOUNT',

    /**
     * The account has no password yet, or a user still needs activation after password proof.
     */
    PENDING_ACCOUNT = 'PENDING_ACCOUNT',

    /**
     * The supplied password does not match the stored password hash.
     */
    INVALID_PASSWORD = 'INVALID_PASSWORD',
}

/**
 * Result shared by credential login handlers; only the created branch contains tokens.
 */
export type CredentialLoginResult =
    | {
          readonly session: SessionOutcome.CREATED;
          readonly accessToken: string;
          readonly refreshToken: string;
      }
    | { readonly session: SessionOutcome.ACTIVATION_REQUIRED };

/**
 * Replays a live login or verifies credentials before opening a session.
 * User and admin login share the same credential and audit rules.
 *
 * @param ports.identityReaderPort Reads credentials and current account eligibility.
 * @param ports.hashingPort Verifies supplied passwords and produces session request fingerprints.
 * @param ports.accessTokenPort Signs access credentials with the dedicated access secret.
 * @param ports.refreshTokenPort Signs refresh credentials with the dedicated refresh secret.
 * @param ports.sessionPort Reads retained success and opens sessions atomically.
 * @param ports.auditPort Records login outcomes.
 * @param ports.accessTokenLifetimePolicy Bounds issued access credentials.
 * @param principalType Owning principal context.
 * @param idempotencyRequest Logical request identity.
 * @param email Account email address.
 * @param password Plain-text password to verify on a new attempt.
 * @returns Session tokens or an activation-required outcome.
 * @throws {ResourceConflictException} When the key belongs to a different request.
 * @throws {UnauthenticatedException} When credentials or the winning session are no longer eligible.
 * @throws {DependencyUnavailableException} When a required dependency is unavailable.
 * @throws {SystemException} When the session decision is unexpected.
 */
export async function login(
    ports: {
        readonly identityReaderPort: IIdentityReaderPort;
        readonly hashingPort: IHashingPort;
        readonly accessTokenPort: ITokenPort<typeof ACCESS_TOKEN_TYPE>;
        readonly refreshTokenPort: ITokenPort<typeof REFRESH_TOKEN_TYPE>;
        readonly sessionPort: ISessionPort;
        readonly auditPort: IAuditPort;
        readonly accessTokenLifetimePolicy: AccessTokenLifetimePolicy;
    },
    principalType: PrincipalType,
    idempotencyRequest: IdempotencyRequest,
    email: string,
    password: string,
): Promise<CredentialLoginResult> {
    let identity;

    try {
        identity = await ports.identityReaderPort.getCredentialsByEmail(principalType, email);
    } catch (error) {
        if (isExceptionOfKind(error, ExceptionKind.RESOURCE_NOT_FOUND)) {
            await ports.hashingPort.simulatePasswordVerify(password);

            throw await auditAndCreateLoginFailure(
                ports.auditPort,
                AuthRejectionReason.ACCOUNT_NOT_FOUND,
                undefined,
                error,
            );
        }

        throw error;
    }

    if (identity.isBanned) {
        await ports.hashingPort.simulatePasswordVerify(password);

        throw await auditAndCreateLoginFailure(ports.auditPort, AuthRejectionReason.INACTIVE_ACCOUNT, identity.id);
    }

    if (!identity.password) {
        await ports.hashingPort.simulatePasswordVerify(password);

        throw await auditAndCreateLoginFailure(ports.auditPort, AuthRejectionReason.PENDING_ACCOUNT, identity.id);
    }

    const requestIdentity: SessionRequestIdentity = {
        key: idempotencyRequest.key,
        fingerprint: ports.hashingPort.hmacSha256(
            SESSION_REQUEST_FINGERPRINT_CONTEXT,
            idempotencyRequest.canonicalValue,
        ),
    };

    let sessionResult: ReplaySessionResult | OpenSessionResult = await ports.sessionPort.findSessionRequestReplay(
        requestIdentity,
        identity.id,
        principalType,
    );

    switch (sessionResult.outcome) {
        case ReplaySessionOutcome.CONFLICT:
            throw new ResourceConflictException(ResourceConflictMessage.IDEMPOTENCY_KEY_CONFLICT);
        case ReplaySessionOutcome.REPLAY_UNAVAILABLE:
        case ReplaySessionOutcome.SESSION_UNAVAILABLE:
        case ReplaySessionOutcome.VERSION_SUPERSEDED:
            throw new UnauthenticatedException(UnauthenticatedMessage.CREDENTIALS);
        case ReplaySessionOutcome.REPLAYED:
            break;
        case ReplaySessionOutcome.NOT_FOUND: {
            if (!(await ports.hashingPort.verifyPassword(identity.password, password))) {
                throw await auditAndCreateLoginFailure(
                    ports.auditPort,
                    AuthRejectionReason.INVALID_PASSWORD,
                    identity.id,
                );
            }

            if (identity.requiresActivation) {
                await ports.auditPort.record({
                    action: AuthAuditAction.LOGIN_FAILED,
                    reason: AuthRejectionReason.PENDING_ACCOUNT,
                    targetId: identity.id,
                });

                return { session: SessionOutcome.ACTIVATION_REQUIRED };
            }

            sessionResult = await ports.sessionPort.openSession(
                requestIdentity,
                identity.id,
                principalType,
                identity.sessionVersion,
            );

            switch (sessionResult.outcome) {
                case ReplaySessionOutcome.CONFLICT:
                    throw new ResourceConflictException(ResourceConflictMessage.IDEMPOTENCY_KEY_CONFLICT);
                case ReplaySessionOutcome.REPLAY_UNAVAILABLE:
                case ReplaySessionOutcome.SESSION_UNAVAILABLE:
                case ReplaySessionOutcome.VERSION_SUPERSEDED:
                    throw new UnauthenticatedException(UnauthenticatedMessage.CREDENTIALS);
                case ReplaySessionOutcome.REPLAYED:
                    break;
                case OpenSessionOutcome.VERSION_SUPERSEDED:
                    throw new UnauthenticatedException(UnauthenticatedMessage.CREDENTIALS);
                case OpenSessionOutcome.OPENED:
                    break;
                default:
                    rejectUnexpectedLoginResult(sessionResult);
            }

            break;
        }
        default:
            rejectUnexpectedLoginResult(sessionResult);
    }

    const { session } = sessionResult,
        [accessToken, refreshToken] = await Promise.all([
            ports.accessTokenPort.sign<AccessTokenPayload>(ACCESS_TOKEN_TYPE, {
                exp: ports.accessTokenLifetimePolicy.getAccessExpiresAt(session.refreshExpiresAt),
                sub: identity.id,
                sid: session.sid,
                principalType: session.principalType,
                permissions: identity.permissions,
                sessionVersion: session.sessionVersion,
            }),
            ports.refreshTokenPort.sign<RefreshTokenPayload>(REFRESH_TOKEN_TYPE, {
                sid: session.sid,
                sessionExpiresAt: session.sessionExpiresAt,
                exp: session.refreshExpiresAt,
                sub: identity.id,
                principalType: session.principalType,
                jti: session.refreshCredentialId,
                sessionVersion: session.sessionVersion,
            }),
        ]);

    if (sessionResult.outcome === OpenSessionOutcome.OPENED) {
        await ports.auditPort.record({ action: AuthAuditAction.LOGIN_SUCCESS, targetId: identity.id });
    }

    return { session: SessionOutcome.CREATED, accessToken, refreshToken };
}

/**
 * Records refusal evidence before returning the uniform credentials exception.
 * Internal reasons stay out of client responses and diagnostic context.
 *
 * @param auditPort The port the failed attempt is recorded on
 * @param reason Why the attempt was rejected — the audit record's own vocabulary
 * @param targetId The rejected account's id, absent when no account matched the email
 * @param cause The underlying failure when the refusal translates a caught error
 * @returns The exception the caller throws
 * @throws {DependencyUnavailableException} When the refusal audit cannot reach its database
 */
async function auditAndCreateLoginFailure(
    auditPort: IAuditPort,
    reason: AuthRejectionReason,
    targetId?: string,
    cause?: unknown,
): Promise<UnauthenticatedException> {
    await auditPort.record({ action: AuthAuditAction.LOGIN_FAILED, reason, ...(targetId && { targetId }) });

    return new UnauthenticatedException(UnauthenticatedMessage.CREDENTIALS, {
        ...(cause !== undefined && { cause }),
    });
}

/**
 * Rejects unsupported session decisions and requires exhaustive login outcome handling.
 *
 * @param sessionResult Unsupported session result used only for exhaustive type checking.
 * @returns Never returns because the decision violates the session contract.
 */
function rejectUnexpectedLoginResult(sessionResult: never): never {
    void sessionResult;

    throw new SystemException('Login received an unexpected session outcome.', {
        context: { class: login.name, method: login.name },
    });
}
