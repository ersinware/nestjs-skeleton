/**
 * @file session.adapter.ts
 * @description Redis session authority with atomic rotation, closure, and access admission.
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ENV, parseTtlToSeconds } from 'src/core/config';
import { isRedisUnavailable } from 'src/core/redis';
import {
    RotateOutcome,
    type ISessionPort,
    type SessionRegistration,
} from 'src/core/security/session/port/session.port';
import { TOKEN_SESSION_CONNECTION } from 'src/core/security/session/session-connection.token';
import type { PrincipalType } from 'src/shared/domain/principal';
import { DependencyUnavailableException, DependencyUnavailableMessage, SystemException } from 'src/shared/exception';

/** The principal hash tag colocates keys used by each atomic operation. */
const SessionKeys = {
    /** Identifies the account-wide minimum accepted access-token version. */
    version: (id: string): string => `auth:{${id}}:version`,

    /**  Identifies the stable session record, including its credential deadlines. */
    session: (id: string, type: PrincipalType, sid: string): string => `auth:{${id}}:${type}:session:${sid}`,

    /** Identifies the grace marker for a consumed refresh credential. */
    tombstone: (id: string, type: PrincipalType, sid: string, jti: string): string =>
        `auth:{${id}}:${type}:rotated:${sid}:${jti}`,
};

/**
 * KEYS: version, session. ARGV: registration JSON, independent version TTL.
 * Token issuance owns deadlines; opening rejects newer account versions and existing session records.
 */
const OPEN_SESSION_LUA = `
local session = cjson.decode(ARGV[1])
local storedVersion = redis.call('GET', KEYS[1])
if storedVersion and tonumber(storedVersion) > session.sessionVersion then
    return 0
end
if redis.call('EXISTS', KEYS[2]) == 1 then
    return 0
end
redis.call('SET', KEYS[2], ARGV[1], 'EXAT', session.refreshExpiresAt)
redis.call('SET', KEYS[1], session.sessionVersion, 'EX', math.max(tonumber(ARGV[2]), redis.call('TTL', KEYS[1])))
return 1
`;

/**
 * KEYS: session, old credential tombstone, version.
 * ARGV: old jti, replacement JSON, version TTL, grace TTL.
 * Missing/expired sessions never rotate. A live-session replay outside grace closes the family
 * before returning, independently of downstream account-wide revocation delivery.
 */
const ROTATE_SESSION_LUA = `
local storedSessionJson = redis.call('GET', KEYS[1])
if not storedSessionJson then
    return -2
end
local now = tonumber(redis.call('TIME')[1])
local storedSession = cjson.decode(storedSessionJson)
local replacementSession = cjson.decode(ARGV[2])
if storedSession.sessionExpiresAt <= now or storedSession.refreshExpiresAt <= now then
    return -2
end
local storedVersion = redis.call('GET', KEYS[3])
if storedVersion and tonumber(storedVersion) > replacementSession.sessionVersion then
    return -2
end
if storedSession.refreshTokenJti ~= ARGV[1] then
    if redis.call('EXISTS', KEYS[2]) == 1 then
        return 0
    end
    redis.call('DEL', KEYS[1])
    return -1
end
redis.call('SET', KEYS[1], cjson.encode(replacementSession), 'EXAT', replacementSession.refreshExpiresAt)
redis.call('SET', KEYS[2], '1', 'EX', ARGV[4])
redis.call('SET', KEYS[3], replacementSession.sessionVersion, 'EX', math.max(tonumber(ARGV[3]), redis.call('TTL', KEYS[3])))
return 1
`;

/** KEYS: version, session. ARGV: access version. Read-only admission has no TTL renewal. */
const CHECK_SESSION_LUA = `
local storedVersion = redis.call('GET', KEYS[1])
if not storedVersion or tonumber(ARGV[1]) < tonumber(storedVersion) then
    return 0
end
local storedSessionJson = redis.call('GET', KEYS[2])
if not storedSessionJson then
    return 0
end
local storedSession = cjson.decode(storedSessionJson)
if storedSession.sessionExpiresAt <= tonumber(redis.call('TIME')[1]) then
    return 0
end
return 1
`;

/** KEYS: version. ARGV: candidate floor, retention independent of any individual session. */
const VERSION_LUA = `
local storedVersion = redis.call('GET', KEYS[1])
local version = tonumber(ARGV[1])
if storedVersion then
    version = math.max(tonumber(storedVersion), version)
end
redis.call('SET', KEYS[1], version, 'EX', math.max(tonumber(ARGV[2]), redis.call('TTL', KEYS[1])))
return 1
`;

/** All instances coordinate through the session Redis; missing state always denies access. */
@Injectable()
export class SessionAdapter implements ISessionPort {
    /** Retains account floors for at least either credential's configured lifetime. */
    private readonly versionTtlSeconds: number;

    /** Per-consumed-credential grace, allowing several rapid rotations without losing history. */
    private readonly rotationGraceTtlSeconds: number;

    /**
     * @param redis Session authority connection.
     * @param configService Boot-validated lifetimes.
     */
    constructor(
        @Inject(TOKEN_SESSION_CONNECTION) private readonly redis: Redis,
        configService: ConfigService,
    ) {
        this.versionTtlSeconds = Math.max(
            parseTtlToSeconds(configService.getOrThrow<string>(ENV.JWT_REFRESH_TTL)),
            parseTtlToSeconds(configService.getOrThrow<string>(ENV.JWT_ACCESS_TTL)),
        );
        this.rotationGraceTtlSeconds = parseTtlToSeconds(
            configService.getOrThrow<string>(ENV.SESSION_ROTATION_GRACE_TTL),
        );
    }

    /**
     * Translates availability failures only; programming and Redis command errors propagate.
     * @param operation Required session operation.
     * @returns Operation result.
     */
    private async run<T>(operation: () => Promise<T>): Promise<T> {
        try {
            return await operation();
        } catch (error) {
            if (isRedisUnavailable(error)) {
                throw new DependencyUnavailableException(DependencyUnavailableMessage.DEFAULT, { cause: error });
            }
            throw error;
        }
    }

    /**
     * Registers freshly authenticated credentials without exposing intermediate state.
     * @param id Principal identifier.
     * @param session Signed identity and deadlines.
     * @returns Whether registration succeeded.
     */
    async openSession(id: string, session: SessionRegistration): Promise<boolean> {
        return (
            (await this.run(() =>
                this.redis.eval(
                    OPEN_SESSION_LUA,
                    2,
                    SessionKeys.version(id),
                    SessionKeys.session(id, session.principalType, session.sid),
                    JSON.stringify(session),
                    this.versionTtlSeconds,
                ),
            )) === 1
        );
    }

    /**
     * Atomically admits one refresh winner or rejects and classifies the credential.
     * @param id Principal identifier.
     * @param oldJti Presented refresh identifier.
     * @param session Replacement with unchanged identity and absolute deadline.
     * @returns Rotation decision.
     */
    async rotateSession(id: string, oldJti: string, session: SessionRegistration): Promise<RotateOutcome> {
        const result = await this.run(() =>
            this.redis.eval(
                ROTATE_SESSION_LUA,
                3,
                SessionKeys.session(id, session.principalType, session.sid),
                SessionKeys.tombstone(id, session.principalType, session.sid, oldJti),
                SessionKeys.version(id),
                oldJti,
                JSON.stringify(session),
                this.versionTtlSeconds,
                this.rotationGraceTtlSeconds,
            ),
        );

        switch (result) {
            case 1:
                return RotateOutcome.ROTATED;
            case 0:
                return RotateOutcome.CONCURRENT_REPLAY;
            case -1:
                return RotateOutcome.REUSE_DETECTED;
            case -2:
                return RotateOutcome.SESSION_CLOSED;
            default:
                throw new SystemException('Unexpected session rotation result.', {
                    context: {
                        class: this.constructor.name,
                        method: this.rotateSession.name,
                    },
                });
        }
    }

    /**
     * Deletes the stable session; subsequent access and rotation reject the missing record.
     * @param id Principal identifier.
     * @param principalType Owning context.
     * @param sid Signature-verified session identifier.
     */
    async closeSession(id: string, principalType: PrincipalType, sid: string) {
        await this.run(() => this.redis.del(SessionKeys.session(id, principalType, sid)));
    }

    /**
     * Reads session validity and account floor in one round trip.
     * @param id Principal identifier.
     * @param principalType Owning context.
     * @param sid Signature-verified session identifier.
     * @param version Issued access version.
     * @returns Whether the access token is admitted.
     */
    async isSessionActive(id: string, principalType: PrincipalType, sid: string, version: number): Promise<boolean> {
        return (
            (await this.run(() =>
                this.redis.eval(
                    CHECK_SESSION_LUA,
                    2,
                    SessionKeys.version(id),
                    SessionKeys.session(id, principalType, sid),
                    version,
                ),
            )) === 1
        );
    }

    /**
     * Mirrors the monotonic account access floor without sweeping sessions.
     * @param id Principal identifier.
     * @param version Candidate floor.
     */
    async setVersion(id: string, version: number) {
        await this.run(() => this.redis.eval(VERSION_LUA, 1, SessionKeys.version(id), version, this.versionTtlSeconds));
    }

    /**
     * Reads the mirrored account floor.
     * @param id Principal identifier.
     * @returns Stored floor or null.
     */
    async getVersion(id: string): Promise<number | null> {
        const version = await this.run(() => this.redis.get(SessionKeys.version(id)));

        return version === null ? null : Number(version);
    }
}
