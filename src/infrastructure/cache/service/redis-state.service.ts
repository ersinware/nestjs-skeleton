/**
 * @file redis-state.service.ts
 * @description Redis implementation of session and ban state management operations.
 */

import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { AuthUserRole } from 'src/common/auth/enum/auth-user-role.enum';
import { TOKEN_CACHE_STATE_CLIENT } from 'src/common/port/cache/cache.constant';
import type { ICacheStateService } from 'src/common/port/cache/cache-state-service.interface';

/**
 * Service managing state operations backed by the state Redis client.
 */
@Injectable()
export class RedisStateService implements ICacheStateService {
    /**
     * Creates an instance of RedisStateService.
     *
     * @param redis The injected Redis client.
     */
    constructor(@Inject(TOKEN_CACHE_STATE_CLIENT) private readonly redis: Redis) {}

    /**
     * Saves a refresh session for a principal.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     * @param ttlSeconds The time-to-live in seconds.
     */
    async saveSession(role: AuthUserRole, id: string, jti: string, ttlSeconds: number) {
        await this.redis.set(`session:${role}:${id}:${jti}`, '1', 'EX', ttlSeconds);
    }

    /**
     * Retrieves a specific refresh session for a principal.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     * @returns The session value if found, otherwise null.
     */
    async getSession(role: AuthUserRole, id: string, jti: string): Promise<string | null> {
        return this.redis.get(`session:${role}:${id}:${jti}`);
    }

    /**
     * Deletes a specific refresh session for a principal.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     */
    async deleteSession(role: AuthUserRole, id: string, jti: string) {
        await this.redis.del(`session:${role}:${id}:${jti}`);
    }

    /**
     * Deletes all sessions for a principal.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    async deleteAllSessions(role: AuthUserRole, id: string) {
        let cursor = '0';
        const pattern = `session:${role}:${id}:*`;

        do {
            const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = nextCursor;

            if (keys.length > 0) {
                await this.redis.del(...keys);
            }
        } while (cursor !== '0');
    }

    /**
     * Bans a principal by blacklisting their access token.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @param ttlSeconds The time-to-live in seconds.
     */
    async saveBan(role: AuthUserRole, id: string, ttlSeconds: number) {
        await this.redis.set(`banned:${role}:${id}`, '1', 'EX', ttlSeconds);
    }

    /**
     * Unbans a principal.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     */
    async deleteBan(role: AuthUserRole, id: string) {
        await this.redis.del(`banned:${role}:${id}`);
    }

    /**
     * Checks if a principal is banned.
     *
     * @param role The role designation.
     * @param id The principal identifier.
     * @returns A promise resolving to true if banned, otherwise false.
     */
    async isBanned(role: AuthUserRole, id: string): Promise<boolean> {
        return (await this.redis.exists(`banned:${role}:${id}`)) > 0;
    }
}
