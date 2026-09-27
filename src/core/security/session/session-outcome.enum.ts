/**
 * @file session-outcome.enum.ts
 * @description Outcomes returned by authentication and operations that may open a session.
 */

/**
 * Identifies the session outcome returned by an authentication-related operation.
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

    /**
     * The mutation committed, but the client must sign in again.
     */
    LOGIN_REQUIRED = 'login_required',
}
