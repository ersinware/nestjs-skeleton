/**
 * @file adapter.ts
 * @description Service responsible for managing user and admin sessions directly in Redis.
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { TOKEN_CACHE_STATE_CLIENT } from 'src/core/cache';
import { ENV } from 'src/core/config';
import type { ISessionPort } from 'src/core/security/session/port';
import { RotateOutcome } from 'src/core/security/session/rotate-outcome.enum';
import { SystemException } from 'src/shared/exception';

/**
 * Monotonic-max write of the session version: advances the stored value only when the incoming
 * version is strictly greater, so it never regresses regardless of delivery order or write source
 * (the command sync-write and the reconcile listener). Atomic across the read-compare-write.
 * KEYS[1] = version key; ARGV[1] = version; ARGV[2] = ttl seconds.
 */
const VERSION_LUA = `
local stored = redis.call('GET', KEYS[1])
if stored and tonumber(stored) >= tonumber(ARGV[1]) then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1
`;

/**
 * Atomic three-state rotation of a refresh session. Deleting the old session and opening the new one is
 * one indivisible step, so two concurrent refreshes carrying the same token cannot both rotate — only
 * the first DEL observes the key. The same script also drops a short-lived tombstone on the old jti,
 * which lets the loser of that race be told apart from a genuine attacker:
 *   - old session deleted  → rotate, write tombstone, return 1 (ROTATED).
 *   - old session gone but tombstone still present → benign concurrent/duplicate replay, return 0.
 *   - old session gone and no tombstone → the token was rotated long ago and is being replayed after the
 *     grace window, i.e. reuse, return -1.
 * KEYS[1] = old session key; KEYS[2] = new session key; KEYS[3] = tombstone key (old jti).
 * ARGV[1] = session ttl seconds; ARGV[2] = grace ttl seconds.
 */
const ROTATE_SESSION_LUA = `
if redis.call('DEL', KEYS[1]) == 1 then
  redis.call('SET', KEYS[2], '1', 'EX', ARGV[1])
  redis.call('SET', KEYS[3], '1', 'EX', ARGV[2])
  return 1
end
if redis.call('EXISTS', KEYS[3]) == 1 then
  return 0
end
return -1
`;

/**
 * Service responsible for managing user and administrator refresh sessions and session versions directly in Redis.
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
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     */
    async openSession(id: string, jti: string) {
        await this.redis.set(
            `session:${id}:${jti}`,
            '1',
            'EX',
            this.parseTtlToSeconds(this.configService.getOrThrow<string>(ENV.JWT_REFRESH_TTL)),
        );
    }

    /**
     * Removes a specific refresh session for a principal from the cache.
     *
     * @param id The principal identifier.
     * @param jti The unique JWT ID of the refresh token.
     */
    async closeSession(id: string, jti: string) {
        await this.redis.del(`session:${id}:${jti}`);
    }

    /**
     * Atomically closes the old refresh session and opens the new one via the rotation Lua script, so
     * the swap is a single indivisible step and the old session doubles as the single-use gate. A grace
     * tombstone written alongside the swap lets a lost concurrent-refresh race (benign) be distinguished
     * from a post-grace replay (reuse), collapsing the classification into one round trip.
     *
     * @param id The principal identifier.
     * @param oldJti The JWT ID of the refresh token being rotated away.
     * @param newJti The JWT ID of the newly issued refresh token.
     * @returns The rotation outcome: rotated, benign concurrent replay, or reuse detected.
     */
    async rotateSession(id: string, oldJti: string, newJti: string): Promise<RotateOutcome> {
        const result = await this.redis.eval(
            ROTATE_SESSION_LUA,
            3,
            `session:${id}:${oldJti}`,
            `session:${id}:${newJti}`,
            `rotated:${id}:${oldJti}`,
            this.parseTtlToSeconds(this.configService.getOrThrow<string>(ENV.JWT_REFRESH_TTL)),
            this.parseTtlToSeconds(this.configService.getOrThrow<string>(ENV.SESSION_ROTATION_GRACE_TTL)),
        );

        if (result === 1) {
            return RotateOutcome.ROTATED;
        }

        if (result === 0) {
            return RotateOutcome.CONCURRENT_REPLAY;
        }

        return RotateOutcome.REUSE_DETECTED;
    }

    /**
     * Removes every refresh session for a principal by scanning and deleting all of their session
     * keys, logging them out of all devices in a single operation.
     *
     * @param id The principal identifier.
     */
    async closeAllSessions(id: string) {
        const pattern = `session:${id}:*`;
        let cursor = '0';

        do {
            const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = nextCursor;

            if (keys.length > 0) {
                await this.redis.del(...keys);
            }
        } while (cursor !== '0');
    }

    /**
     * Advances the session version via the monotonic-max Lua script, so it never regresses even under
     * out-of-order or concurrent writes from the command sync-write and the reconcile listener.
     * TTL-bounded to the refresh-token lifetime, the longest a token carrying a stale version can live.
     *
     * @param id The principal identifier.
     * @param version The candidate session version.
     */
    async setVersion(id: string, version: number) {
        await this.redis.eval(
            VERSION_LUA,
            1,
            `version:${id}`,
            version,
            this.parseTtlToSeconds(this.configService.getOrThrow<string>(ENV.JWT_REFRESH_TTL)),
        );
    }

    /**
     * Reads the cached session version: the minimum version a token must carry to be accepted.
     *
     * @param id The principal identifier.
     * @returns The version, or 0 when none is set.
     */
    async getVersion(id: string): Promise<number> {
        const value = await this.redis.get(`version:${id}`);

        return value ? Number(value) : 0;
    }

    /**
     * Helper to convert time-to-live string expressions (e.g. '15m', '7d') into seconds.
     *
     * @param ttl The TTL string to convert.
     * @returns The duration in seconds.
     * @throws {SystemException} if the TTL format is invalid or unsupported.
     */
    parseTtlToSeconds(ttl: string): number {
        const matches = ttl.match(/^(\d+)([smhd])$/);

        if (!matches) {
            throw new SystemException(`Invalid TTL format: "${ttl}". Expected format like "15m", "7d", "1h", "30s".`, {
                context: { class: this.constructor.name, method: this.parseTtlToSeconds.name },
            });
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
                throw new SystemException(`Unsupported TTL unit in "${ttl}"`, {
                    context: { class: this.constructor.name, method: this.parseTtlToSeconds.name },
                });
        }
    }
}
