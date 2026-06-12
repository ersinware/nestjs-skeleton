/**
 * @file cache-state-service.interface.ts
 * @description Interface defining the contract for managing session and ban states.
 */

import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';

export interface ICacheStateService {
    /**
     * Saves a refresh session for a principal.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     * @param ttlSeconds The time-to-live in seconds.
     * @returns A promise resolving on execution success.
     */
    saveSession(role: AuthUserRole, id: string, jti: string, ttlSeconds: number): Promise<void>;

    /**
     * Retrieves a specific refresh session for a principal.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     * @returns The session value if found, otherwise null.
     */
    getSession(role: AuthUserRole, id: string, jti: string): Promise<string | null>;

    /**
     * Deletes a specific refresh session for a principal.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     * @returns A promise resolving on execution success.
     */
    deleteSession(role: AuthUserRole, id: string, jti: string): Promise<void>;

    /**
     * Deletes all sessions for a principal.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @returns A promise resolving on execution success.
     */
    deleteAllSessions(role: AuthUserRole, id: string): Promise<void>;

    /**
     * Bans a principal by blacklisting their access token.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param ttlSeconds The time-to-live in seconds.
     * @returns A promise resolving on execution success.
     */
    saveBan(role: AuthUserRole, id: string, ttlSeconds: number): Promise<void>;

    /**
     * Unbans a principal.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @returns A promise resolving on execution success.
     */
    deleteBan(role: AuthUserRole, id: string): Promise<void>;

    /**
     * Checks if a principal is banned.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @returns A promise resolving to true if banned, otherwise false.
     */
    isBanned(role: AuthUserRole, id: string): Promise<boolean>;
}
