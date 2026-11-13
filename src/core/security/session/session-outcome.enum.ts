/**
 * @file session-outcome.enum.ts
 * @description Outcomes returned by credential login.
 */

/**
 * Identifies whether credential login opened a session or requires activation.
 */
export enum SessionOutcome {
    /**
     * A session was opened and its token pair is included.
     */
    CREATED = 'created',

    /**
     * Credentials are valid, but the account must be activated before a session can open.
     */
    ACTIVATION_REQUIRED = 'activation_required',
}
