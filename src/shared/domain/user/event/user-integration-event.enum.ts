/**
 * @file user-integration-event.enum.ts
 * @description Cross-module integration events raised about a user by another bounded context.
 */

/**
 * Integration events about a user, published by another bounded context (e.g. auth) and consumed
 * by the user module. Kept in `shared/domain` so publisher and subscriber reference the same
 * contract without an illegal module-to-module import.
 */
export enum UserIntegrationEvent {
    /**
     * Auth detected refresh-token reuse for this user. The user module reacts by revoking every session
     * and emailing the account owner a security notice.
     */
    REFRESH_REUSE_DETECTED = 'user.refresh_reuse_detected.v1',

    /**
     * The user asked to be signed out of every device. Auth closes the refresh sessions it owns;
     * the user module bumps the session counters that kill the outstanding access tokens.
     */
    LOGOUT_ALL_REQUESTED = 'user.logout_all_requested.v1',
}
