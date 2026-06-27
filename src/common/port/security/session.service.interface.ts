/**
 * @file session.service.interface.ts
 * @description Contract for the SessionService.
 */

import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';

export interface ISessionService {
    /**
     * Registers a new refresh session for a principal in the cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     */
    openSession(role: AuthUserRole, id: string, jti: string): Promise<void>;

    /**
     * Retrieves a specific refresh session for a principal from the cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     * @returns The cached session value, or null if not found.
     */
    getSession(role: AuthUserRole, id: string, jti: string): Promise<string | null>;

    /**
     * Removes a specific refresh session for a principal from the cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     */
    closeSession(role: AuthUserRole, id: string, jti: string): Promise<void>;

    /**
     * Helper to delete all session keys for a principal.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    closeAllSessions(role: AuthUserRole, id: string): Promise<void>;

    /**
     * Helper to blacklist access tokens in cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    ban(role: AuthUserRole, id: string): Promise<void>;

    /**
     * Helper to remove access token blacklist in cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    unban(role: AuthUserRole, id: string): Promise<void>;
}
