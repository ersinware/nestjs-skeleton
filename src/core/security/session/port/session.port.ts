/**
 * @file session.service.interface.ts
 * @description Contract for the SessionService.
 */

import type { RotateOutcome } from 'src/core/security/session/rotate-outcome.enum';

export const TOKEN_SESSION_PORT = Symbol('TOKEN_SESSION_PORT');

/**
 * Contract for managing refresh sessions and session versions in the state store.
 */
export interface ISessionPort {
    /**
     * Registers a new refresh session for a principal in the cache.
     *
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     * @throws {SystemException} When the configured session TTL format cannot be parsed — a
     * configuration bug that must surface as 500.
     */
    openSession(id: string, jti: string): Promise<void>;

    /**
     * Removes a specific refresh session for a principal from the cache.
     *
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     */
    closeSession(id: string, jti: string): Promise<void>;

    /**
     * Atomically rotates a refresh session: closes the current session and opens the next one in a
     * single Redis round trip, so no state in between can be observed or interleaved by a concurrent
     * refresh. Acts as the single-use gate and, in the same script, writes a short-lived tombstone for
     * the old jti so the outcome can be classified three ways instead of a bare success/fail: a real
     * rotation, a benign concurrent/duplicate replay still inside the grace window, or genuine
     * post-grace reuse that must revoke the whole family.
     *
     * @param id The principal identifier.
     * @param oldJti The JWT ID of the refresh token being rotated away.
     * @param newJti The JWT ID of the newly issued refresh token.
     * @returns The rotation outcome the caller must react to.
     * @throws {SystemException} When a configured TTL format cannot be parsed — a configuration
     * bug that must surface as 500.
     */
    rotateSession(id: string, oldJti: string, newJti: string): Promise<RotateOutcome>;

    /**
     * Removes every refresh session for a principal, logging them out of all devices.
     *
     * @param id The principal identifier.
     */
    closeAllSessions(id: string): Promise<void>;

    /**
     * Advances the cached session version using a monotonic-max write: the stored value moves forward
     * only when `version` is strictly greater, so it never regresses regardless of source or delivery
     * order. The DB is the authority; this only mirrors it for the guard's hot path.
     *
     * @param id The principal identifier.
     * @param version The candidate session version (the aggregate's monotonic version counter).
     * @throws {SystemException} When the configured version TTL format cannot be parsed — a
     * configuration bug that must surface as 500.
     */
    setVersion(id: string, version: number): Promise<void>;

    /**
     * Reads the cached session version: the minimum version a token must carry to be accepted.
     *
     * @param id The principal identifier.
     * @returns The version, or 0 when none is set.
     */
    getVersion(id: string): Promise<number>;
}
