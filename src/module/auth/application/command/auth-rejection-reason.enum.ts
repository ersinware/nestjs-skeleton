/**
 * @file auth-rejection-reason.enum.ts
 * @description Shared vocabulary naming why an authentication attempt was deliberately rejected. Written by the auth command handlers into the `reason` of their own audit records.
 */

/**
 * The reasons the auth commands (login, refresh) deliberately reject an attempt.
 *
 * Owned by the auth module — the handlers that decide the rejection — because only they can tell an
 * unknown email from a wrong password, and none of it reaches the client: the response says no more
 * than "credentials", so an attacker cannot use the distinction to enumerate accounts. The reason
 * travels to the auditor alone, as {@link AuditRecordInput.reason}, never as exception context.
 */
export enum AuthRejectionReason {
    ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',
    INACTIVE_ACCOUNT = 'ACCOUNT_IS_INACTIVE',
    INVALID_PASSWORD = 'INVALID_PASSWORD',
    SESSION_REUSE = 'SESSION_REUSE',
}
