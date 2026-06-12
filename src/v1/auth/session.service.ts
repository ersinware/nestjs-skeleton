/**
 * @file session.service.ts
 * @description Service responsible for managing user and admin sessions in the cache.
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TOKEN_CACHE_STATE_SERVICE } from 'src/cache/constant/cache.constant';
import type { ICacheStateService } from 'src/cache/interface/cache-state-service.interface';
import { ENV } from 'src/common/config/constant/env.constant';
import { AuthUserRole } from 'src/common/enum/auth/auth-user-role.enum';

@Injectable()
export class SessionService {
    /**
     * Creates an instance of SessionService.
     *
     * @param cacheStateService Domain-specific session state service contract.
     * @param configService Configuration reader service.
     */
    constructor(
        @Inject(TOKEN_CACHE_STATE_SERVICE) private readonly cacheStateService: ICacheStateService,
        private readonly configService: ConfigService,
    ) {}

    /**
     * Registers a new refresh session for a principal in the cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     */
    async openSession(role: AuthUserRole, id: string, jti: string) {
        await this.cacheStateService.saveSession(
            role,
            id,
            jti,
            this.parseTtlToSeconds(this.configService.getOrThrow<string>(ENV.JWT_REFRESH_TTL)),
        );
    }

    /**
     * Retrieves a specific refresh session for a principal from the cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     * @returns The cached session value, or null if not found.
     */
    async getSession(role: AuthUserRole, id: string, jti: string) {
        return this.cacheStateService.getSession(role, id, jti);
    }

    /**
     * Removes a specific refresh session for a principal from the cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     */
    async closeSession(role: AuthUserRole, id: string, jti: string) {
        await this.cacheStateService.deleteSession(role, id, jti);
    }

    /**
     * Helper to delete all session keys for a principal.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    async closeAllSessions(role: AuthUserRole, id: string) {
        await this.cacheStateService.deleteAllSessions(role, id);
    }

    /**
     * Helper to blacklist access tokens in cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    async ban(role: AuthUserRole, id: string) {
        const ttlSeconds = this.parseTtlToSeconds(this.configService.getOrThrow<string>(ENV.JWT_ACCESS_TTL));
        await this.cacheStateService.saveBan(role, id, ttlSeconds);
    }

    /**
     * Helper to remove access token blacklist in cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    async unban(role: AuthUserRole, id: string) {
        await this.cacheStateService.deleteBan(role, id);
    }

    /**
     * Helper to convert time-to-live string expressions (e.g. '15m', '7d') into seconds.
     *
     * @param ttl The TTL string to convert.
     * @returns The duration in seconds.
     * @throws {Error} if the TTL format is invalid or unsupported.
     */
    parseTtlToSeconds(ttl: string) {
        const matches = ttl.match(/^(\d+)([smhd])$/);

        if (!matches) {
            throw new Error(`Invalid TTL format: "${ttl}". Expected format like "15m", "7d", "1h", "30s".`);
        }

        const value = parseInt(matches[1]!, 10);

        switch (matches[2]!) {
            case 's':
                return value;
            case 'm':
                return value * 60;
            case 'h':
                return value * 60 * 60;
            case 'd':
                return value * 24 * 60 * 60;
            default:
                throw new Error(`Unsupported TTL unit in "${ttl}"`);
        }
    }
}
