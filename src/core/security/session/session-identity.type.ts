/**
 * @file session-identity.type.ts
 * @description Immutable identity and absolute deadline shared by a session's token rotations.
 */

/** Identifies one login and its fixed deadline in Unix seconds. */
export type SessionIdentity = {
    /** Random identifier generated once for each authenticated login. */
    readonly sid: string;

    /** Absolute deadline, never extended by refresh. */
    readonly sessionExpiresAt: number;
};
