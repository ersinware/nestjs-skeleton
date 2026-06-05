/**
 * @file session.service.ts
 * @description Service responsible for managing user and admin sessions in the cache.
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TOKEN_CACHE_SERVICE } from 'src/cache/constant/cache.constant';
import type { ICacheService } from 'src/cache/interface/cache-service.interface';
import { ENV } from 'src/common/config/constant/env.constant';
import { AuthUserRole } from 'src/common/guard/enum/auth-user-role.enum';

@Injectable()
export class SessionService {
    /**
     * Creates an instance of SessionService.
     *
     * @param cacheService Generic cache service contract.
     * @param configService Configuration reader service.
     */
    constructor(
        @Inject(TOKEN_CACHE_SERVICE) private readonly cacheService: ICacheService,
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
        await this.cacheService.set(
            `session:${role}:${id}:${jti}`,
            '1',
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
        return this.cacheService.get(`session:${role}:${id}:${jti}`);
    }

    /**
     * Removes a specific refresh session for a principal from the cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     */
    async closeSession(role: AuthUserRole, id: string, jti: string) {
        await this.cacheService.delete(`session:${role}:${id}:${jti}`);
    }

    /**
     * Helper to delete all session keys for a principal.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    async closeAllSessions(role: AuthUserRole, id: string) {
        await this.cacheService.deletePattern(`session:${role}:${id}:*`);
    }

    /**
     * Helper to blacklist access tokens in cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    async ban(role: AuthUserRole, id: string) {
        await this.cacheService.set(
            `banned:${role}:${id}`,
            '1',
            this.parseTtlToSeconds(this.configService.getOrThrow<string>(ENV.JWT_ACCESS_TTL)),
        );
    }

    /**
     * Helper to remove access token blacklist in cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    async unban(role: AuthUserRole, id: string) {
        await this.cacheService.delete(`banned:${role}:${id}`);
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
