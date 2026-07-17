/**
 * @file admin-integration-event.enum.ts
 * @description Cross-module integration events raised *about* an admin by a bounded context other than
 * the admin module (e.g. auth). Kept in `shared/domain` so both the publisher and the admin-module
 * subscriber reference the same contract without an illegal module-to-module import.
 */

/**
 * Integration events about an admin, published by another bounded context and consumed by the admin module.
 */
export enum AdminIntegrationEvent {
    /**
     * Auth detected refresh-token reuse for this admin. The admin module reacts by revoking every session
     * and emailing the account owner a security notice.
     */
    REFRESH_REUSE_DETECTED = 'admin.refresh_reuse_detected',
}
