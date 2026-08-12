/**
 * @file login.util.ts
 * @description The single credential-login flow shared by the user and admin login commands: identity lookup, ban check, password verification, session opening, and the audit records of the decision.
 */

import { AuditAction, type IAuditPort } from 'src/core/observability/audit';
import type { IHashingPort } from 'src/core/security/hashing';
import type { ISessionPort } from 'src/core/security/session';
import type { ITokenPort } from 'src/core/security/token';
import { IdentityRealm, type IIdentityReaderPort } from 'src/module/auth/application/command/port/identity-reader.port';
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
    ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',
    INACTIVE_ACCOUNT = 'ACCOUNT_IS_INACTIVE',
    INVALID_PASSWORD = 'INVALID_PASSWORD',
}

/**
 * Authenticates an email/password pair against the given realm and opens a fresh session.
 *
 * One implementation for both realms on purpose: every security property of the flow — the deny
 * order, the audit records, the uniform "credentials" response that blocks account enumeration —
 * must hold identically for users and admins, and a single body is what guarantees a future fix
 * (e.g. timing hardening) cannot land in one realm and miss the other.
 *
 * @param ports The ports the flow runs on, injected by the calling handler
 * @param realm The identity realm the credentials authenticate against
 * @param email The email address identifying the account
 * @param password The plain-text password to verify
 * @returns The generated access and refresh token pair
 * @throws {UnauthenticatedException} When credentials are invalid or the account is inactive.
 */
export async function login(
    ports: {
        identityReaderPort: IIdentityReaderPort;
        hashingPort: IHashingPort;
        tokenPort: ITokenPort;
        sessionPort: ISessionPort;
        auditPort: IAuditPort;
    },
    realm: IdentityRealm,
    email: string,
    password: string,
): Promise<{ accessToken: string; refreshToken: string }> {
    let identity;

    try {
        identity = await ports.identityReaderPort.getCredentialsByEmail(realm, email);
    } catch (error) {
        if (isExceptionOfKind(error, ExceptionKind.RESOURCE_NOT_FOUND)) {
            throw denyLogin(ports.auditPort, AuthRejectionReason.ACCOUNT_NOT_FOUND);
        }

        throw error;
    }

    if (identity.isBanned) {
        throw denyLogin(ports.auditPort, AuthRejectionReason.INACTIVE_ACCOUNT, identity.id);
    }

    if (!(await ports.hashingPort.verify(identity.password, password))) {
        throw denyLogin(ports.auditPort, AuthRejectionReason.INVALID_PASSWORD, identity.id);
    }

    const id = identity.id,
        tokens = await ports.tokenPort.generateTokens(identity.role, id, identity.sessionVersion);

    // Uncaught on purpose: the guard fails closed on a missing version key, so a login that cannot
    // write it must 503 instead of minting dead-on-arrival tokens.
    await ports.sessionPort.setVersion(id, identity.sessionVersion);
    await ports.sessionPort.openSession(id, tokens.refreshTokenJti);
    ports.auditPort.record({ action: AuditAction.LOGIN_SUCCESS, targetId: id });

    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
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
 * it attached would duplicate the same event into the operational log as a `warn`.
 *
 * @param auditPort The port the failed attempt is recorded on
 * @param reason Why the attempt was rejected — the audit record's own vocabulary
 * @param targetId The rejected account's id, absent when no account matched the email
 * @returns The exception the caller throws
 */
function denyLogin(auditPort: IAuditPort, reason: AuthRejectionReason, targetId?: string): UnauthenticatedException {
    auditPort.record({ action: AuditAction.LOGIN_FAILED, reason, ...(targetId && { targetId }) });

    return new UnauthenticatedException(UnauthenticatedMessage.CREDENTIALS);
}
