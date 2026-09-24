/**
 * @file login.util.ts
 * @description The single credential-login flow shared by the user and admin login commands: identity lookup, ban check, password verification, session opening, and the audit records of the decision.
 */

import { AuditAction, type IAuditPort } from 'src/core/observability/audit';
import type { IHashingPort } from 'src/core/security/hashing';
import type { ISessionPort } from 'src/core/security/session';
import type { ITokenPort } from 'src/core/security/token';
import type { IIdentityReaderPort } from 'src/module/auth/application/command/port/identity-reader.port';
import type { PrincipalType } from 'src/shared/domain/principal';
import {
    ExceptionKind,
    UnauthenticatedException,
    UnauthenticatedMessage,
    isExceptionOfKind,
} from 'src/shared/exception';

/**
 * The reasons the credential-login flow deliberately rejects an attempt.
 *
 * Lives with the flow — the only code that decides the rejection — because only it can tell an
 * unknown email from a wrong password, and none of it reaches the client: the response says no more
 * than "credentials", so an attacker cannot use the distinction to enumerate accounts. The reason
 * travels to the auditor alone, as {@link AuditRecordInput.reason}, never as exception context.
 */
enum AuthRejectionReason {
    /**
     * No account matches the email within the requested principal context.
     */
    ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',

    /**
     * The account is banned from authenticating.
     */
    INACTIVE_ACCOUNT = 'ACCOUNT_IS_INACTIVE',

    /**
     * The account has no password yet and requires activation.
     */
    PENDING_ACCOUNT = 'ACCOUNT_PENDING_ACTIVATION',

    /**
     * The supplied password does not match the stored password hash.
     */
    INVALID_PASSWORD = 'INVALID_PASSWORD',

    /**
     * Session opening was rejected because a newer account version or the same session already exists.
     */
    SESSION_SUPERSEDED = 'SESSION_SUPERSEDED',
}

/**
 * Authenticates an email/password pair against the given kind of principal and opens a fresh session.
 *
 * One implementation for both kinds on purpose: every security property of the flow — the deny
 * order, the audit records, the uniform "credentials" response that blocks account enumeration —
 * must hold identically for users and admins, and a single body is what guarantees a future fix
 * (e.g. timing hardening) cannot land in one kind and miss the other.
 *
 * @param ports The ports the flow runs on, injected by the calling handler
 * @param principalType The kind of principal the credentials authenticate against
 * @param email The email address identifying the account
 * @param password The plain-text password to verify
 * @returns The generated access and refresh token pair
 * @throws {UnauthenticatedException} When credentials are invalid, the account is inactive, or a newer session version supersedes the login.
 * @throws {DependencyUnavailableException} When a required dependency is unavailable.
 */
export async function login(
    ports: {
        readonly identityReaderPort: IIdentityReaderPort;
        readonly hashingPort: IHashingPort;
        readonly tokenPort: ITokenPort;
        readonly sessionPort: ISessionPort;
        readonly auditPort: IAuditPort;
    },
    principalType: PrincipalType,
    email: string,
    password: string,
): Promise<{ readonly accessToken: string; readonly refreshToken: string }> {
    let identity;

    try {
        identity = await ports.identityReaderPort.getCredentialsByEmail(principalType, email);
    } catch (error) {
        if (isExceptionOfKind(error, ExceptionKind.RESOURCE_NOT_FOUND)) {
            // Every refusal decided before the password is verified spends the verification anyway,
            // so response time says no more than the uniform message does — the only defence
            // against enumeration until rate limiting lands.
            await ports.hashingPort.simulateVerify(password);

            throw await denyLogin(ports.auditPort, AuthRejectionReason.ACCOUNT_NOT_FOUND);
        }

        throw error;
    }

    const { id, password: currentPassword } = identity;

    if (identity.isBanned) {
        await ports.hashingPort.simulateVerify(password);

        throw await denyLogin(ports.auditPort, AuthRejectionReason.INACTIVE_ACCOUNT, id);
    }

    // A pending account has no password yet, so there is nothing to verify against until its owner
    // activates it.
    if (!currentPassword) {
        await ports.hashingPort.simulateVerify(password);

        throw await denyLogin(ports.auditPort, AuthRejectionReason.PENDING_ACCOUNT, id);
    }

    if (!(await ports.hashingPort.verify(currentPassword, password))) {
        throw await denyLogin(ports.auditPort, AuthRejectionReason.INVALID_PASSWORD, id);
    }

    const tokenPairWithSession = await ports.tokenPort.generateTokens(
        { id, type: principalType, permissions: identity.permissions },
        identity.sessionVersion,
    );

    // Mirror the version and open the session together; a newer Redis floor means this login's
    // auth snapshot was superseded. Session availability failures propagate without issuing tokens.
    if (!(await ports.sessionPort.openSession(id, tokenPairWithSession.session))) {
        throw await denyLogin(ports.auditPort, AuthRejectionReason.SESSION_SUPERSEDED, id);
    }

    await ports.auditPort.record({ action: AuditAction.LOGIN_SUCCESS, targetId: id });

    return { accessToken: tokenPairWithSession.accessToken, refreshToken: tokenPairWithSession.refreshToken };
}

/**
 * Records the failed attempt and builds the rejection the caller throws.
 *
 * This flow is the only code that knows WHY the attempt failed — the response deliberately says
 * nothing beyond "credentials", so an observer downstream cannot tell an unknown email from a wrong
 * password. Writing the audit record here rather than attaching the reason as exception `context`
 * is what keeps the two apart: the auditor gets the precise reason, the client gets none.
 *
 * The exception therefore carries NO context. Context is a diagnostic channel read on 5xx; a
 * deliberate 401 that has already been audited has nothing left to say to an operator, and leaving
 * it attached would duplicate the same refusal into the operational log as a `warn`.
 *
 * @param auditPort The port the failed attempt is recorded on
 * @param reason Why the attempt was rejected — the audit record's own vocabulary
 * @param targetId The rejected account's id, absent when no account matched the email
 * @returns The exception the caller throws
 */
async function denyLogin(
    auditPort: IAuditPort,
    reason: AuthRejectionReason,
    targetId?: string,
): Promise<UnauthenticatedException> {
    await auditPort.record({ action: AuditAction.LOGIN_FAILED, reason, ...(targetId && { targetId }) });

    return new UnauthenticatedException(UnauthenticatedMessage.CREDENTIALS);
}
