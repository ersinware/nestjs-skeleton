/**
 * @file auth-rejection-reason.enum.ts
 * @description Shared vocabulary naming why an authentication attempt was deliberately rejected. Attached as free-form exception context by the auth command handlers; the exception filter carries it verbatim into the security audit log without ever interpreting it.
 */

/**
 * The reasons the auth commands (login, refresh) deliberately reject an attempt. Owned by the auth
 * module — the throwers — so the exception path never speaks the logger's vocabulary; the filter
 * records it as opaque context.
 */
export enum AuthRejectionReason {
    ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',
    INACTIVE_ACCOUNT = 'ACCOUNT_IS_INACTIVE',
    INVALID_PASSWORD = 'INVALID_PASSWORD',
    SESSION_REVOKED = 'SESSION_REVOKED',
    SESSION_REUSE = 'SESSION_REUSE',
}
