/**
 * @file session-revocation-reason.enum.ts
 * @description Why a principal's sessions are revoked in full.
 */

/**
 * Cause of a full session revocation. The counter bump is the same for every member; the reason
 * decides only whether the account owner is notified, and that decision belongs to the revoking
 * handler, not to the code that requested the revocation.
 */
export enum SessionRevocationReason {
    /**
     * A rotated refresh token was replayed — it may have been stolen.
     */
    REFRESH_REUSE = 'refresh_reuse',

    /**
     * The account owner asked to be signed out of every device.
     */
    LOGOUT_ALL = 'logout_all',
}
