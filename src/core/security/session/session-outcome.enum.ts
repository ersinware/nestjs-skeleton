/**
 * @file session-outcome.enum.ts
 * @description Outcomes returned by operations that may open a session after committing a change.
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
     * The mutation committed, but the client must sign in again.
     */
    LOGIN_REQUIRED = 'login_required',
}
