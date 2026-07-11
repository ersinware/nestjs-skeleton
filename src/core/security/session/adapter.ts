/**
 * @file session.service.ts
 * @description Service responsible for managing user and admin sessions directly in Redis.
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { TOKEN_CACHE_STATE_CLIENT } from 'src/core/cache/constant/constant';
import { ENV } from 'src/core/config';
import type { AuthRole } from 'src/core/security/auth/type/auth-role.type';
import type { ISessionPort } from 'src/core/security/session/port';

/**
 * Service responsible for managing user and administrator session lifetimes and ban status directly in Redis.
 */
@Injectable()
export class SessionAdapter implements ISessionPort {
    /**
     * Creates an instance of SessionAdapter.
     *
     * @param redis The injected Redis client for state management.
     * @param configService Configuration reader service.
     */
    constructor(
        @Inject(TOKEN_CACHE_STATE_CLIENT) private readonly redis: Redis,
        private readonly configService: ConfigService,
    ) {}

    /**
     * Registers a new refresh session for a principal in the cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     */
    async openSession(role: AuthRole, id: string, jti: string) {
        await this.redis.set(
            `session:${role}:${id}:${jti}`,
            '1',
            'EX',
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
    async getSession(role: AuthRole, id: string, jti: string): Promise<string | null> {
        return this.redis.get(`session:${role}:${id}:${jti}`);
    }

    /**
     * Removes a specific refresh session for a principal from the cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     */
    async closeSession(role: AuthRole, id: string, jti: string) {
        await this.redis.del(`session:${role}:${id}:${jti}`);
    }

    /**
     * Helper to delete all session keys for a principal.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    async closeAllSessions(role: AuthRole, id: string) {
        let cursor = '0';

        do {
            const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', `session:${role}:${id}:*`, 'COUNT', 100);
            cursor = nextCursor;

            if (keys.length > 0) {
                await this.redis.del(...keys);
            }
        } while (cursor !== '0');
    }

    /**
     * Helper to blacklist access tokens in cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    async ban(role: AuthRole, id: string) {
        await this.redis.set(
            `banned:${role}:${id}`,
            '1',
            'EX',
            this.parseTtlToSeconds(this.configService.getOrThrow<string>(ENV.JWT_ACCESS_TTL)),
        );
    }

    /**
     * Helper to remove access token blacklist in cache.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    async unban(role: AuthRole, id: string) {
        await this.redis.del(`banned:${role}:${id}`);
    }

    /**
     * Checks if a principal is banned.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @returns A promise resolving to true if banned, otherwise false.
     */
    async isBanned(role: AuthRole, id: string): Promise<boolean> {
        return (await this.redis.exists(`banned:${role}:${id}`)) > 0;
    }

    /**
     * Helper to convert time-to-live string expressions (e.g. '15m', '7d') into seconds.
     *
     * @param ttl The TTL string to convert.
     * @returns The duration in seconds.
     * @throws {Error} if the TTL format is invalid or unsupported.
     */
    parseTtlToSeconds(ttl: string): number {
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
