/**
 * @file session.service.interface.ts
 * @description Contract for the SessionService.
 */

import type { AuthRole } from 'src/core/security/auth/type/auth-role.type';

export const TOKEN_SESSION_PORT = Symbol('TOKEN_SESSION_PORT');

export interface ISessionPort {
    /**
     * Registers a new refresh session for a principal in the cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     */
    openSession(role: AuthRole, id: string, jti: string): Promise<void>;

    /**
     * Retrieves a specific refresh session for a principal from the cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     * @returns The cached session value, or null if not found.
     */
    getSession(role: AuthRole, id: string, jti: string): Promise<string | null>;

    /**
     * Removes a specific refresh session for a principal from the cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     */
    closeSession(role: AuthRole, id: string, jti: string): Promise<void>;

    /**
     * Helper to delete all session keys for a principal.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    closeAllSessions(role: AuthRole, id: string): Promise<void>;

    /**
     * Helper to blacklist access tokens in cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    ban(role: AuthRole, id: string): Promise<void>;

    /**
     * Helper to remove access token blacklist in cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    unban(role: AuthRole, id: string): Promise<void>;

    /**
     * Checks if a principal is banned.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @returns A promise resolving to true if banned, otherwise false.
     */
    isBanned(role: AuthRole, id: string): Promise<boolean>;
}
