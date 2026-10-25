/**
 * @file login.util.ts
 * @description The single credential-login flow shared by the user and admin login commands: identity lookup, ban check, password verification, session opening, and the audit records of the decision.
 */

import { type IAuditPort } from 'src/core/observability/audit';
import type { IHashingPort } from 'src/core/security/hashing';
import { SessionOutcome, type ISessionPort } from 'src/core/security/session';
import type { ITokenPort } from 'src/core/security/token';
import type { IIdentityReaderPort } from 'src/module/auth/application/command/port/identity-reader.port';
import { AuthAuditAction } from 'src/module/auth/shared/auth-audit';
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
     * The account has no password yet, or a user still needs activation after password proof.
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
 * Authenticates an email/password pair against the given kind of principal and opens a fresh session.
 *
 * One implementation for both kinds on purpose: every security property of the flow — the deny
 * order, the audit records, the uniform "credentials" response that blocks account enumeration —
 * must hold identically for users and admins, and a single body is what guarantees a future fix
 * (e.g. timing hardening) cannot land in one kind and miss the other.
 *
 * @param ports.identityReaderPort Loads account credentials for the requested principal kind.
 * @param ports.hashingPort Verifies passwords and performs equivalent work for rejected identities.
 * @param ports.tokenPort Issues the authenticated session tokens.
 * @param ports.sessionPort Registers the session against the current account version.
 * @param ports.auditPort Persists login outcomes and refusal evidence.
 * @param principalType The kind of principal the credentials authenticate against
 * @param email The email address identifying the account
 * @param password The plain-text password to verify
 * @returns A token pair when a session opens, or an activation-required outcome
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
): Promise<CredentialLoginResult> {
    let identity;

    try {
        identity = await ports.identityReaderPort.getCredentialsByEmail(principalType, email);
    } catch (error) {
        if (isExceptionOfKind(error, ExceptionKind.RESOURCE_NOT_FOUND)) {
            // Every refusal decided before the password is verified spends the verification anyway,
            // so response time says no more than the uniform message does — the only defence
            // against enumeration until rate limiting lands.
            await ports.hashingPort.simulateVerify(password);

            throw await denyLogin(ports.auditPort, AuthRejectionReason.ACCOUNT_NOT_FOUND, undefined, error);
        }

        throw error;
    }

    const { id, password: currentPassword } = identity;

    if (identity.isBanned) {
        await ports.hashingPort.simulateVerify(password);

        throw await denyLogin(ports.auditPort, AuthRejectionReason.INACTIVE_ACCOUNT, id);
    }

    // An invited admin has no password until activation. Pending users already have a hash and
    // continue through the real verification below.
    if (!currentPassword) {
        await ports.hashingPort.simulateVerify(password);

        throw await denyLogin(ports.auditPort, AuthRejectionReason.PENDING_ACCOUNT, id);
    }

    if (!(await ports.hashingPort.verify(currentPassword, password))) {
        throw await denyLogin(ports.auditPort, AuthRejectionReason.INVALID_PASSWORD, id);
    }

    /**
     * Reached only when the account exists, is not banned, has a password, and the supplied
     * password matches. For a user still awaiting activation, record the refusal and return
     * without generating tokens or opening a session.
     */
    if (identity.requiresActivation) {
        await ports.auditPort.record({
            action: AuthAuditAction.LOGIN_FAILED,
            reason: AuthRejectionReason.PENDING_ACCOUNT,
            targetId: id,
        });

        return { session: SessionOutcome.ACTIVATION_REQUIRED };
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

    await ports.auditPort.record({ action: AuthAuditAction.LOGIN_SUCCESS, targetId: id });

    return {
        session: SessionOutcome.CREATED,
        accessToken: tokenPairWithSession.accessToken,
        refreshToken: tokenPairWithSession.refreshToken,
    };
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
 * @param cause The underlying failure when the refusal translates a caught error
 * @returns The exception the caller throws
 * @throws {DependencyUnavailableException} When the refusal audit cannot reach its database
 */
async function denyLogin(
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
