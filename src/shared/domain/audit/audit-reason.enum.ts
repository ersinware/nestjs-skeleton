/**
 * @file audit-reason.enum.ts
 * @description Refusal reasons shared across account contexts and workflows.
 */

/**
 * Common reasons preserved in refusal audit evidence.
 */
export enum AuditReason {
    /**
     * Verified proof does not belong to the authenticated principal.
     */
    PRINCIPAL_MISMATCH = 'PRINCIPAL_MISMATCH',
}
