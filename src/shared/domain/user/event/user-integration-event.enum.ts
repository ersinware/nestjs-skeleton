/**
 * @file user-integration-event.enum.ts
 * @description Cross-module integration events raised *about* a user by a bounded context other than the
 * user module (e.g. auth). Kept in `shared/domain` so both the publisher and the user-module subscriber
 * reference the same contract without an illegal module-to-module import.
 */

/**
 * Integration events about a user, published by another bounded context and consumed by the user module.
 */
export enum UserIntegrationEvent {
    /**
     * Auth detected refresh-token reuse for this user. The user module reacts by revoking every session
     * and emailing the account owner a security notice.
     */
    REFRESH_REUSE_DETECTED = 'user.refresh_reuse_detected',
}
