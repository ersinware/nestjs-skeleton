/**
 * @file rotate-outcome.enum.ts
 * @description Classification of a refresh-session rotation attempt, used to distinguish a successful
 * rotation from a benign concurrent replay and from genuine refresh-token reuse.
 */

/**
 * The three mutually exclusive outcomes of an atomic refresh-session rotation.
 *
 * Exists so the caller can react correctly to each case: a lost concurrent-refresh race is benign
 * (reject only that request), whereas replaying a token whose grace window has already lapsed is the
 * RFC 9700 reuse signal that must revoke the whole session family.
 */
export enum RotateOutcome {
    /** The old session existed and was atomically swapped for the new one. */
    ROTATED = 'ROTATED',

    /** The old session was already consumed but its rotation tombstone is still within the grace window — a legitimate concurrent/duplicate refresh, not an attack. */
    CONCURRENT_REPLAY = 'CONCURRENT_REPLAY',

    /** The old session was gone and no grace tombstone remained — a previously rotated token replayed after the grace window, i.e. refresh-token reuse. */
    REUSE_DETECTED = 'REUSE_DETECTED',
}
