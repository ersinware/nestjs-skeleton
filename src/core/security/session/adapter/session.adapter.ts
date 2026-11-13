/**
 * @file session.adapter.ts
 * @description Redis session authority with atomic rotation, closure, and access admission.
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import { ENV, parseTtlToSeconds } from 'src/core/config';
import { isRedisUnavailable } from 'src/core/redis';
import {
    OpenSessionOutcome,
    ReplaySessionOutcome,
    RotateSessionOutcome,
    type ISessionPort,
    type OpenSessionResult,
    type ReplaySessionResult,
    type RotateSessionResult,
    type SessionRegistration,
    type SessionRequestIdentity,
} from 'src/core/security/session/port/session.port';
import { TOKEN_SESSION_CONNECTION } from 'src/core/security/session/session-connection.token';
import { PrincipalType } from 'src/shared/domain/principal';
import { DependencyUnavailableException, DependencyUnavailableMessage, SystemException } from 'src/shared/exception';

/**
 * The principal kind and identifier hash tag colocates keys used by each atomic operation.
 */
const SessionKeys = {
    /**
     * Colocates the request claim with the principal's session keys.
     *
     * @param id Principal identifier.
     * @param type Owning context.
     * @param key Logical request identity.
     * @returns Slot-compatible request key.
     */
    idempotency: (id: string, type: PrincipalType, key: string): string => `auth:{${type}:${id}}:idempotency:${key}`,

    /**
     * Identifies the account-wide minimum accepted access-token version.
     *
     * @param id Principal identifier
     * @param type Owning principal context
     * @returns Redis key for the principal access floor
     */
    version: (id: string, type: PrincipalType): string => `auth:{${type}:${id}}:version`,

    /**
     * Holds independently expiring registrations as SID-indexed hash fields.
     * A declared hash key permits atomic replay lookup without constructing Redis keys in Lua.
     *
     * @param id Principal identifier.
     * @param type Owning context.
     * @returns Principal-scoped session hash.
     */
    sessions: (id: string, type: PrincipalType): string => `auth:{${type}:${id}}:sessions`,

    /**
     * Identifies the grace marker for a consumed refresh credential.
     *
     * @param id Principal identifier
     * @param type Owning principal context
     * @param sid Stable session identifier
     * @param jti Consumed refresh credential identifier
     * @returns Redis key for the credential rotation grace marker
     */
    tombstone: (id: string, type: PrincipalType, sid: string, jti: string): string =>
        `auth:{${type}:${id}}:rotated:${sid}:${jti}`,
};

/**
 * Bounded request retry retention, independent of credential lifetimes.
 */
const IDEMPOTENCY_TTL_SECONDS = 120;

/**
 * KEYS: request, version, sessions. ARGV[1]: fingerprint.
 * Replay resolves the original live registration before any mutation-domain checks.
 */
const REPLAY_SESSION_REQUEST_LUA = `
local storedRequestJson = redis.call('GET', KEYS[1])

if storedRequestJson then
    local storedRequest = cjson.decode(storedRequestJson)

    if storedRequest.fingerprint ~= ARGV[1] then
        return { '${ReplaySessionOutcome.CONFLICT}', false }
    end

    local storedSessionJson = redis.call('HGET', KEYS[3], storedRequest.sid)

    if not storedSessionJson then
        return { '${ReplaySessionOutcome.REPLAY_UNAVAILABLE}', false }
    end

    local storedSession = cjson.decode(storedSessionJson)
    local now = tonumber(redis.call('TIME')[1])
    local storedVersion = redis.call('GET', KEYS[2])

    if storedSession.refreshCredentialId ~= storedRequest.jti
        or storedSession.refreshExpiresAt <= now
    then
        return { '${ReplaySessionOutcome.REPLAY_UNAVAILABLE}', false }
    end

    if not storedVersion then
        return { '${ReplaySessionOutcome.SESSION_UNAVAILABLE}', false }
    end

    if tonumber(storedVersion) > storedSession.sessionVersion then
        return { '${ReplaySessionOutcome.VERSION_SUPERSEDED}', false }
    end

    return { '${ReplaySessionOutcome.REPLAYED}', storedSessionJson }
end
`;

/**
 * Formats server-provided cryptographic entropy only on a new mutation path.
 * Replaces six bits with the UUID v4 version and variant, preserving 122 random bits.
 */
const FORMAT_SESSION_UUID_LUA = `
local function uuid(hex)
    local variant = string.format('%x', 8 + tonumber(string.sub(hex, 17, 17), 16) % 4)

    return string.sub(hex, 1, 8) .. '-' .. string.sub(hex, 9, 12) .. '-4'
        .. string.sub(hex, 14, 16) .. '-' .. variant .. string.sub(hex, 18, 20)
        .. '-' .. string.sub(hex, 21, 32)
end
`;

/**
 * KEYS: request, version, sessions.
 * ARGV: fingerprint, kind, version, entropy, absolute TTL, refresh/version TTL, request TTL.
 */
const OPEN_SESSION_LUA =
    REPLAY_SESSION_REQUEST_LUA +
    FORMAT_SESSION_UUID_LUA +
    `
local version = tonumber(ARGV[3])
local storedVersion = redis.call('GET', KEYS[2])

if storedVersion and tonumber(storedVersion) > version then
    return { '${OpenSessionOutcome.VERSION_SUPERSEDED}', false }
end

local now = tonumber(redis.call('TIME')[1])
local session = {
    principalType = ARGV[2],
    sessionVersion = version,
    sid = uuid(string.sub(ARGV[4], 1, 32)),
    refreshCredentialId = uuid(string.sub(ARGV[4], 33, 64)),
    sessionExpiresAt = now + tonumber(ARGV[5]),
    refreshExpiresAt = now + math.min(tonumber(ARGV[5]), tonumber(ARGV[6]))
}

local sessionJson = cjson.encode(session)

redis.call('HSETEX', KEYS[3], 'EXAT', session.refreshExpiresAt, 'FIELDS', 1, session.sid, sessionJson)
redis.call('SET', KEYS[2], version, 'EX', math.max(tonumber(ARGV[6]), redis.call('TTL', KEYS[2])))
redis.call('SET', KEYS[1], cjson.encode({
    fingerprint = ARGV[1],
    sid = session.sid,
    jti = session.refreshCredentialId
}), 'EX', ARGV[7])

return { '${OpenSessionOutcome.OPENED}', sessionJson }
`;

/**
 * KEYS: version, sessions. ARGV: access version, SID. Read-only admission has no TTL renewal.
 */
const CHECK_SESSION_ACCESS_LUA = `
local storedVersion = redis.call('GET', KEYS[1])
if not storedVersion or tonumber(ARGV[1]) < tonumber(storedVersion) then
    return 0
end

local storedSessionJson = redis.call('HGET', KEYS[2], ARGV[2])
if not storedSessionJson then
    return 0
end

local storedSession = cjson.decode(storedSessionJson)
if storedSession.sessionExpiresAt <= tonumber(redis.call('TIME')[1]) then
    return 0
end

return 1
`;

/**
 * KEYS: request, version, sessions, old credential tombstone.
 * ARGV: fingerprint, old JTI, verified identity/version JSON, entropy, refresh/version TTL,
 * grace TTL, request TTL. Same-key replay precedes grace/reuse classification.
 */
const ROTATE_SESSION_LUA =
    REPLAY_SESSION_REQUEST_LUA +
    FORMAT_SESSION_UUID_LUA +
    `
local session = cjson.decode(ARGV[3])
local storedSessionJson = redis.call('HGET', KEYS[3], session.sid)

if not storedSessionJson then
    return { '${RotateSessionOutcome.SESSION_CLOSED}', false }
end

local now = tonumber(redis.call('TIME')[1])
local storedSession = cjson.decode(storedSessionJson)

if storedSession.refreshExpiresAt <= now then
    return { '${RotateSessionOutcome.SESSION_CLOSED}', false }
end

local storedVersion = redis.call('GET', KEYS[2])
if not storedVersion then
    return { '${RotateSessionOutcome.SESSION_UNAVAILABLE}', false }
end

if tonumber(storedVersion) > session.sessionVersion then
    return { '${RotateSessionOutcome.VERSION_SUPERSEDED}', false }
end

if storedSession.refreshCredentialId ~= ARGV[2] then
    if redis.call('EXISTS', KEYS[4]) == 1 then
        return { '${RotateSessionOutcome.CONCURRENT_REPLAY}', false }
    end

    redis.call('HDEL', KEYS[3], session.sid)

    return { '${RotateSessionOutcome.REUSE_DETECTED}', false }
end

storedSession.sessionVersion = session.sessionVersion
storedSession.refreshCredentialId = uuid(ARGV[4])
storedSession.refreshExpiresAt = math.min(now + tonumber(ARGV[5]), storedSession.sessionExpiresAt)

local sessionJson = cjson.encode(storedSession)

redis.call('HSETEX', KEYS[3], 'EXAT', storedSession.refreshExpiresAt, 'FIELDS', 1, storedSession.sid, sessionJson)
redis.call('SET', KEYS[4], '1', 'EX', ARGV[6])
redis.call('SET', KEYS[2], storedSession.sessionVersion, 'EX', math.max(tonumber(ARGV[5]), redis.call('TTL', KEYS[2])))
redis.call('SET', KEYS[1], cjson.encode({
    fingerprint = ARGV[1],
    sid = storedSession.sid,
    jti = storedSession.refreshCredentialId
}), 'EX', ARGV[7])

return { '${RotateSessionOutcome.ROTATED}', sessionJson }
`;

/**
 * KEYS: version. ARGV: candidate floor, retention independent of any individual session.
 */
const ADVANCE_SESSION_VERSION_LUA = `
local storedVersion = redis.call('GET', KEYS[1])
local version = tonumber(ARGV[1])

if storedVersion then
    version = math.max(tonumber(storedVersion), version)
end

redis.call('SET', KEYS[1], version, 'EX', math.max(tonumber(ARGV[2]), redis.call('TTL', KEYS[1])))

return 1
`;

/**
 * All instances coordinate through the session Redis; missing state always denies access.
 */
@Injectable()
export class SessionAdapter implements ISessionPort {
    /**
     * Absolute login lifetime for each principal context.
     */
    private readonly sessionTtlByPrincipalType: Readonly<Record<PrincipalType, number>>;

    /**
     * Refresh lifetime, capped by each session's immutable absolute deadline; also retains version floors.
     */
    private readonly sessionRefreshTtlSeconds: number;

    /**
     * Per-consumed-credential grace, allowing several rapid rotations without losing history.
     */
    private readonly rotationGraceTtlSeconds: number;

    /**
     * Configures session retention and rotation grace on the session connection.
     *
     * @param redis Session authority connection.
     * @param configService Boot-validated lifetimes.
     */
    constructor(
        @Inject(TOKEN_SESSION_CONNECTION) private readonly redis: Redis,
        configService: ConfigService,
    ) {
        this.sessionTtlByPrincipalType = {
            [PrincipalType.ADMIN]: parseTtlToSeconds(configService.getOrThrow<string>(ENV.SESSION_ABSOLUTE_TTL_ADMIN)),
            [PrincipalType.USER]: parseTtlToSeconds(configService.getOrThrow<string>(ENV.SESSION_ABSOLUTE_TTL_USER)),
        } satisfies Record<PrincipalType, number>;
        this.sessionRefreshTtlSeconds = parseTtlToSeconds(configService.getOrThrow<string>(ENV.SESSION_REFRESH_TTL));
        this.rotationGraceTtlSeconds = parseTtlToSeconds(
            configService.getOrThrow<string>(ENV.SESSION_ROTATION_GRACE_TTL),
        );
    }

    /**
     * Opens or replays a session with one atomic Redis decision.
     * Entropy is formatted into identities only if Lua admits a new mutation.
     *
     * @param requestIdentity Logical request identity and precomputed fingerprint.
     * @param id Principal identifier.
     * @param principalType Owning context.
     * @param sessionVersion Current account version.
     * @returns Opening decision and winning live registration on success.
     */
    async openSession(
        requestIdentity: SessionRequestIdentity,
        id: string,
        principalType: PrincipalType,
        sessionVersion: number,
    ): Promise<OpenSessionResult> {
        const result = (await this.run(() =>
                this.redis.eval(
                    OPEN_SESSION_LUA,
                    3,
                    SessionKeys.idempotency(id, principalType, requestIdentity.key),
                    SessionKeys.version(id, principalType),
                    SessionKeys.sessions(id, principalType),
                    requestIdentity.fingerprint,
                    principalType,
                    sessionVersion,
                    randomBytes(32).toString('hex'),
                    this.sessionTtlByPrincipalType[principalType],
                    this.sessionRefreshTtlSeconds,
                    IDEMPOTENCY_TTL_SECONDS,
                ),
            )) as
                | readonly [OpenSessionOutcome.OPENED | ReplaySessionOutcome.REPLAYED, string]
                | readonly [
                      (
                          | ReplaySessionOutcome.CONFLICT
                          | ReplaySessionOutcome.REPLAY_UNAVAILABLE
                          | ReplaySessionOutcome.SESSION_UNAVAILABLE
                          | ReplaySessionOutcome.VERSION_SUPERSEDED
                          | OpenSessionOutcome.VERSION_SUPERSEDED
                      ),
                      null,
                  ],
            outcome = result[0];

        switch (outcome) {
            case ReplaySessionOutcome.CONFLICT:
            case ReplaySessionOutcome.REPLAY_UNAVAILABLE:
            case ReplaySessionOutcome.SESSION_UNAVAILABLE:
            case ReplaySessionOutcome.VERSION_SUPERSEDED:
                return { outcome, session: null };
            case ReplaySessionOutcome.REPLAYED:
            case OpenSessionOutcome.OPENED:
                return {
                    outcome,
                    session: JSON.parse(result[1]) as SessionRegistration,
                };
            case OpenSessionOutcome.VERSION_SUPERSEDED:
                return { outcome, session: null };
            default:
                throw new SystemException('Unexpected session opening result.', {
                    context: { class: this.constructor.name, method: this.openSession.name, outcome },
                });
        }
    }

    /**
     * Resolves retained success with the same atomic liveness checks used by mutations.
     *
     * @param requestIdentity Logical request identity and precomputed fingerprint.
     * @param principalId Principal identifier.
     * @param principalType Owning context.
     * @returns Read-only replay decision and credential metadata when live.
     */
    async findSessionRequestReplay(
        requestIdentity: SessionRequestIdentity,
        principalId: string,
        principalType: PrincipalType,
    ): Promise<ReplaySessionResult> {
        const result = (await this.run(() =>
                this.redis.eval(
                    REPLAY_SESSION_REQUEST_LUA + `return { '${ReplaySessionOutcome.NOT_FOUND}', false }`,
                    3,
                    SessionKeys.idempotency(principalId, principalType, requestIdentity.key),
                    SessionKeys.version(principalId, principalType),
                    SessionKeys.sessions(principalId, principalType),
                    requestIdentity.fingerprint,
                ),
            )) as
                | readonly [ReplaySessionOutcome.REPLAYED, string]
                | readonly [Exclude<ReplaySessionOutcome, ReplaySessionOutcome.REPLAYED>, null],
            outcome = result[0];

        switch (outcome) {
            case ReplaySessionOutcome.CONFLICT:
            case ReplaySessionOutcome.REPLAY_UNAVAILABLE:
            case ReplaySessionOutcome.SESSION_UNAVAILABLE:
            case ReplaySessionOutcome.VERSION_SUPERSEDED:
                return { outcome, session: null };
            case ReplaySessionOutcome.REPLAYED:
                return {
                    outcome,
                    session: JSON.parse(result[1]) as SessionRegistration,
                };
            case ReplaySessionOutcome.NOT_FOUND:
                return { outcome, session: null };
            default:
                throw new SystemException('Session request replay returned an unexpected outcome.', {
                    context: { class: this.constructor.name, method: this.findSessionRequestReplay.name, outcome },
                });
        }
    }

    /**
     * Reads session validity and account floor in one round trip.
     *
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
                    CHECK_SESSION_ACCESS_LUA,
                    2,
                    SessionKeys.version(id, principalType),
                    SessionKeys.sessions(id, principalType),
                    version,
                    sid,
                ),
            )) === 1
        );
    }

    /**
     * Settles request replay before classifying refresh-domain reuse.
     *
     * @param requestIdentity Logical request identity and precomputed fingerprint.
     * @param id Principal identifier.
     * @param oldJti Presented credential identifier.
     * @param session Verified session identity and current account version.
     * @returns Rotation decision and winning registration.
     */
    async rotateSession(
        requestIdentity: SessionRequestIdentity,
        id: string,
        oldJti: string,
        session: Omit<SessionRegistration, 'refreshCredentialId' | 'refreshExpiresAt'>,
    ): Promise<RotateSessionResult> {
        const result = (await this.run(() =>
                this.redis.eval(
                    ROTATE_SESSION_LUA,
                    4,
                    SessionKeys.idempotency(id, session.principalType, requestIdentity.key),
                    SessionKeys.version(id, session.principalType),
                    SessionKeys.sessions(id, session.principalType),
                    SessionKeys.tombstone(id, session.principalType, session.sid, oldJti),
                    requestIdentity.fingerprint,
                    oldJti,
                    JSON.stringify(session),
                    randomBytes(16).toString('hex'),
                    this.sessionRefreshTtlSeconds,
                    this.rotationGraceTtlSeconds,
                    IDEMPOTENCY_TTL_SECONDS,
                ),
            )) as
                | readonly [RotateSessionOutcome.ROTATED | ReplaySessionOutcome.REPLAYED, string]
                | readonly [
                      (
                          | ReplaySessionOutcome.CONFLICT
                          | ReplaySessionOutcome.REPLAY_UNAVAILABLE
                          | ReplaySessionOutcome.SESSION_UNAVAILABLE
                          | ReplaySessionOutcome.VERSION_SUPERSEDED
                          | RotateSessionOutcome.SESSION_UNAVAILABLE
                          | RotateSessionOutcome.VERSION_SUPERSEDED
                          | RotateSessionOutcome.SESSION_CLOSED
                          | RotateSessionOutcome.CONCURRENT_REPLAY
                          | RotateSessionOutcome.REUSE_DETECTED
                      ),
                      null,
                  ],
            outcome = result[0];

        switch (outcome) {
            case ReplaySessionOutcome.CONFLICT:
            case ReplaySessionOutcome.REPLAY_UNAVAILABLE:
            case ReplaySessionOutcome.SESSION_UNAVAILABLE:
            case ReplaySessionOutcome.VERSION_SUPERSEDED:
                return { outcome, session: null };
            case ReplaySessionOutcome.REPLAYED:
            case RotateSessionOutcome.ROTATED:
                return {
                    outcome,
                    session: JSON.parse(result[1]) as SessionRegistration,
                };
            case RotateSessionOutcome.SESSION_CLOSED:
            case RotateSessionOutcome.SESSION_UNAVAILABLE:
            case RotateSessionOutcome.VERSION_SUPERSEDED:
            case RotateSessionOutcome.CONCURRENT_REPLAY:
            case RotateSessionOutcome.REUSE_DETECTED:
                return { outcome, session: null };
            default:
                throw new SystemException('Unexpected session rotation result.', {
                    context: { class: this.constructor.name, method: this.rotateSession.name, outcome },
                });
        }
    }

    /**
     * Deletes the stable session; subsequent access and rotation reject the missing record.
     *
     * @param id Principal identifier.
     * @param principalType Owning context.
     * @param sid Signature-verified session identifier.
     */
    async closeSession(id: string, principalType: PrincipalType, sid: string) {
        await this.run(() => this.redis.hdel(SessionKeys.sessions(id, principalType), sid));
    }

    /**
     * Mirrors the monotonic account access floor without sweeping sessions.
     *
     * @param id Principal identifier.
     * @param principalType Owning context.
     * @param version Candidate floor.
     */
    async setVersion(id: string, principalType: PrincipalType, version: number) {
        await this.run(() =>
            this.redis.eval(
                ADVANCE_SESSION_VERSION_LUA,
                1,
                SessionKeys.version(id, principalType),
                version,
                this.sessionRefreshTtlSeconds,
            ),
        );
    }

    /**
     * Reads the mirrored account floor.
     *
     * @param id Principal identifier.
     * @param principalType Owning context.
     * @returns Stored floor or null.
     */
    async getVersion(id: string, principalType: PrincipalType): Promise<number | null> {
        const version = await this.run(() => this.redis.get(SessionKeys.version(id, principalType)));

        return version === null ? null : Number(version);
    }

    /**
     * Translates availability failures only; programming and Redis command errors propagate.
     *
     * @param operation Required session operation.
     * @returns Operation result.
     * @throws {DependencyUnavailableException} When the session connection is unavailable
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
}
