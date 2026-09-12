/**
 * @file session.port.ts
 * @description Contract for managing refresh sessions and session versions in the session store.
 */

/**
 * Dependency injection token for the {@link ISessionPort} contract.
 */
export const TOKEN_SESSION_PORT = Symbol('TOKEN_SESSION_PORT');

/**
 * The three mutually exclusive outcomes of an atomic refresh-session rotation. Exists so the caller
 * can react to each case: a lost concurrent-refresh race is benign (reject only that request),
 * whereas a post-grace replay is the RFC 9700 reuse signal that must revoke the whole session family.
 */
export enum RotateOutcome {
    /** The old session existed and was atomically swapped for the new one. */
    ROTATED = 'ROTATED',

    /** The old session was already consumed but its tombstone is still within the grace window — a benign concurrent/duplicate refresh. */
    CONCURRENT_REPLAY = 'CONCURRENT_REPLAY',

    /** The old session was gone with no tombstone — a replay after the grace window, i.e. refresh-token reuse. */
    REUSE_DETECTED = 'REUSE_DETECTED',
}

/**
 * Contract for managing refresh sessions and session versions in the session store.
 */
export interface ISessionPort {
    /**
     * Registers a new refresh session for a principal.
     *
     * @param id The principal identifier.
     * @param jti The JWT ID of the refresh token.
     * @throws {DependencyUnavailableException} When the session store is unreachable.
     */
    openSession(id: string, jti: string): Promise<void>;

    /**
     * Atomically mirrors a committed version and opens a session unless a newer version is stored.
     *
     * @param id The principal identifier.
     * @param jti The fresh refresh token identifier.
     * @param version The committed version used to sign the tokens.
     * @returns Whether the session was opened; false means a newer version superseded it.
     * @throws {DependencyUnavailableException} When the session store is unreachable.
     */
    openSessionAtVersion(id: string, jti: string, version: number): Promise<boolean>;

    /**
     * Atomically closes the current session and opens the next one in a single round trip, so no
     * intermediate state can be observed by a concurrent refresh — the old session doubles as the
     * single-use gate. A short-lived tombstone written in the same step classifies the outcome as a
     * real rotation, a benign replay inside the grace window, or genuine post-grace reuse.
     *
     * @param id The principal identifier.
     * @param oldJti The JWT ID of the refresh token being rotated away.
     * @param newJti The JWT ID of the newly issued refresh token.
     * @returns The rotation outcome the caller must react to.
     * @throws {DependencyUnavailableException} When the session store is unreachable.
     */
    rotateSession(id: string, oldJti: string, newJti: string): Promise<RotateOutcome>;

    /**
     * Removes a specific refresh session for a principal.
     *
     * @param id The principal identifier.
     * @param jti The JWT ID of the refresh token.
     * @throws {DependencyUnavailableException} When the session store is unreachable.
     */
    closeSession(id: string, jti: string): Promise<void>;

    /**
     * Removes every refresh session for a principal, logging them out of all devices. Rotation
     * tombstones go too: a survivor would let a token of the revoked family classify as a benign
     * replay instead of reuse.
     *
     * @param id The principal identifier.
     * @throws {DependencyUnavailableException} When the session store is unreachable.
     */
    closeAllSessions(id: string): Promise<void>;

    /**
     * Advances the cached session version with a monotonic-max write: the stored value moves only
     * when `version` is strictly greater, so a racing stale write cannot resurrect revoked tokens.
     * Every write renews the key's TTL, keeping a live session's key alive for the fail-closed
     * guard. The DB is the authority; this mirrors it for the guard's hot path.
     *
     * @param id The principal identifier.
     * @param version The candidate session version (the aggregate's monotonic counter).
     * @throws {DependencyUnavailableException} When the session store is unreachable.
     */
    setVersion(id: string, version: number): Promise<void>;

    /**
     * Reads the cached session version: the minimum version a token must carry to be accepted.
     * Login and refresh keep every live session's key alive, so a missing key means no live
     * session — the caller must fail closed, never substitute a permissive default.
     *
     * @param id The principal identifier.
     * @returns The version, or null when no live session exists.
     * @throws {DependencyUnavailableException} When the session store is unreachable.
     */
    getVersion(id: string): Promise<number | null>;
}
