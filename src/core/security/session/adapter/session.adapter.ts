/**
 * @file session.adapter.ts
 * @description Redis implementation of the session port for user and admin refresh sessions.
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ENV } from 'src/core/config';
import type { ISessionPort } from 'src/core/security/session/port/session.port';
import { RotateOutcome } from 'src/core/security/session/port/session.port';
import { TOKEN_SESSION_CONNECTION } from 'src/core/security/session/session-connection.token';
import { DependencyUnavailableException, DependencyUnavailableMessage, SystemException } from 'src/shared/exception';

/**
 * Seconds per TTL unit, keyed exactly by the units the TTL regex admits — parsing needs no
 * fallback branch.
 */
const TTL_UNIT_SECONDS: Record<string, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
};

/**
 * Single source of every Redis key this adapter touches, so a mutator and the scan pattern that
 * deletes its keys cannot drift apart on a rename.
 */
const SessionKeys = {
    session: (id: string, jti: string) => `session:${id}:${jti}`,
    sessionPattern: (id: string) => `session:${id}:*`,
    tombstone: (id: string, jti: string) => `rotated:${id}:${jti}`,
    tombstonePattern: (id: string) => `rotated:${id}:*`,
    version: (id: string) => `version:${id}`,
};

/**
 * Atomic three-state rotation. Deleting the old session and opening the new one is one indivisible
 * step, so two concurrent refreshes carrying the same token cannot both rotate — only the first DEL
 * observes the key. A short-lived tombstone on the old jti tells the loser of that race apart from
 * an attacker:
 *   - old session deleted → rotate, write tombstone, return 1.
 *   - old session gone, tombstone present → benign concurrent/duplicate replay, return 0.
 *   - old session gone, no tombstone → post-grace replay, i.e. reuse, return -1.
 * KEYS[1] = old session; KEYS[2] = new session; KEYS[3] = tombstone (old jti).
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
 * Monotonic-max write of the session version: advances the stored value only when the incoming one
 * is strictly greater, so it never regresses under out-of-order or concurrent writes. Atomic across
 * the read-compare-write. Both branches renew the TTL, so a live session's key cannot expire under
 * the fail-closed guard.
 * KEYS[1] = version key; ARGV[1] = version; ARGV[2] = ttl seconds.
 */
const VERSION_LUA = `
local stored = redis.call('GET', KEYS[1])
if stored and tonumber(stored) >= tonumber(ARGV[1]) then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1
`;

/**
 * Manages refresh sessions and session versions directly in the session store Redis.
 */
@Injectable()
export class SessionAdapter implements ISessionPort {
    /**
     * Refresh-token lifetime in seconds — the TTL of every session key and of the version key
     * (the longest a token carrying a stale version can live).
     */
    private readonly refreshTtlSeconds: number;

    /**
     * Rotation grace window in seconds — the TTL of the tombstone that classifies a replay as benign.
     */
    private readonly rotationGraceTtlSeconds: number;

    /**
     * TTLs are parsed once here: they are boot-validated constants, so an invalid format fails the
     * application at startup instead of on the hot path.
     *
     * @param redis The session store Redis client.
     * @param configService Configuration reader.
     * @throws {SystemException} When a configured TTL format cannot be parsed — a configuration bug.
     */
    constructor(
        @Inject(TOKEN_SESSION_CONNECTION) private readonly redis: Redis,
        configService: ConfigService,
    ) {
        this.refreshTtlSeconds = this.parseTtlToSeconds(configService.getOrThrow<string>(ENV.JWT_REFRESH_TTL));
        this.rotationGraceTtlSeconds = this.parseTtlToSeconds(
            configService.getOrThrow<string>(ENV.SESSION_ROTATION_GRACE_TTL),
        );
    }

    /**
     * Runs a session store operation, translating any driver error at the port boundary. The session
     * store is authoritative — nothing here may fail open — so an unreachable store is a retryable
     * dependency outage for every caller, never a raw ioredis error escaping infrastructure.
     *
     * @param operation The Redis operation to execute
     * @returns The operation's result
     * @throws {DependencyUnavailableException} When the session store operation fails
     */
    private async run<T>(operation: () => Promise<T>): Promise<T> {
        try {
            return await operation();
        } catch (error) {
            throw new DependencyUnavailableException(DependencyUnavailableMessage.DEFAULT, { cause: error });
        }
    }

    /**
     * Registers a new refresh session for a principal.
     *
     * @param id The principal identifier.
     * @param jti The JWT ID of the refresh token.
     */
    async openSession(id: string, jti: string) {
        await this.run(() => this.redis.set(SessionKeys.session(id, jti), '1', 'EX', this.refreshTtlSeconds));
    }

    /**
     * Rotates a refresh session via the rotation Lua script — see {@link ROTATE_SESSION_LUA} for the
     * atomicity and classification semantics.
     *
     * @param id The principal identifier.
     * @param oldJti The JWT ID of the refresh token being rotated away.
     * @param newJti The JWT ID of the newly issued refresh token.
     * @returns The rotation outcome.
     */
    async rotateSession(id: string, oldJti: string, newJti: string): Promise<RotateOutcome> {
        const result = await this.run(() =>
            this.redis.eval(
                ROTATE_SESSION_LUA,
                3,
                SessionKeys.session(id, oldJti),
                SessionKeys.session(id, newJti),
                SessionKeys.tombstone(id, oldJti),
                this.refreshTtlSeconds,
                this.rotationGraceTtlSeconds,
            ),
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
     * Removes a specific refresh session for a principal.
     *
     * @param id The principal identifier.
     * @param jti The JWT ID of the refresh token.
     */
    async closeSession(id: string, jti: string) {
        await this.run(() => this.redis.del(SessionKeys.session(id, jti)));
    }

    /**
     * Sweeps every session key and rotation tombstone of a principal. Tombstones must go with the
     * sessions: a survivor would classify a token of the revoked family as a benign replay.
     *
     * @param id The principal identifier.
     */
    async closeAllSessions(id: string) {
        await Promise.all([
            this.deleteByPattern(SessionKeys.sessionPattern(id)),
            this.deleteByPattern(SessionKeys.tombstonePattern(id)),
        ]);
    }

    /**
     * Advances the session version via the monotonic-max Lua script. TTL-bounded to the
     * refresh-token lifetime, the longest a token carrying a stale version can live.
     *
     * @param id The principal identifier.
     * @param version The candidate session version.
     */
    async setVersion(id: string, version: number) {
        await this.run(() => this.redis.eval(VERSION_LUA, 1, SessionKeys.version(id), version, this.refreshTtlSeconds));
    }

    /**
     * Reads the cached session version. Absence is returned as null, never coerced to a permissive
     * default — the guard fails closed on it.
     *
     * @param id The principal identifier.
     * @returns The version, or null when no live session exists.
     */
    async getVersion(id: string): Promise<number | null> {
        const version = await this.run(() => this.redis.get(SessionKeys.version(id)));

        return version === null ? null : Number(version);
    }

    /**
     * Scans and deletes every key matching the pattern.
     *
     * @param pattern The Redis key pattern to sweep.
     */
    private async deleteByPattern(pattern: string) {
        await this.run(async () => {
            let cursor = '0';

            do {
                const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
                cursor = nextCursor;

                if (keys.length > 0) {
                    await this.redis.del(...keys);
                }
            } while (cursor !== '0');
        });
    }

    /**
     * Converts a TTL expression (e.g. '15m', '7d') into seconds.
     *
     * @param ttl The TTL string to convert.
     * @returns The duration in seconds.
     * @throws {SystemException} When the format is invalid.
     */
    private parseTtlToSeconds(ttl: string): number {
        const matches = ttl.match(/^(\d+)([smhd])$/);

        if (!matches) {
            throw new SystemException(`Invalid TTL format: "${ttl}". Expected format like "15m", "7d", "1h", "30s".`, {
                context: { class: this.constructor.name, method: this.parseTtlToSeconds.name },
            });
        }

        return parseInt(matches[1]!, 10) * TTL_UNIT_SECONDS[matches[2]!]!;
    }
}
