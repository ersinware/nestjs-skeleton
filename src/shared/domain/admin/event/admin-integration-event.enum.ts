/**
 * @file admin-integration-event.enum.ts
 * @description Cross-module integration events raised about an admin by another bounded context.
 */

/**
 * Integration events about an admin, published by another bounded context (e.g. auth) and consumed
 * by the admin module. Kept in `shared/domain` so publisher and subscriber reference the same
 * contract without an illegal module-to-module import.
 */
export enum AdminIntegrationEvent {
    /**
     * Auth detected refresh-token reuse for this admin. The admin module reacts by revoking every session
     * and emailing the account owner a security notice.
     */
    REFRESH_REUSE_DETECTED = 'admin.refresh_reuse_detected',
}
