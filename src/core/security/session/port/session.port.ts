/**
 * @file session.port.ts
 * @description Atomic session lifecycle and account-wide access-version contracts.
 */

import type { IdempotencyRequest } from 'src/core/idempotency';
import type { SessionIdentity } from 'src/core/security/session/session-identity.type';
import type { PrincipalType } from 'src/shared/domain/principal';

/**
 * Dependency injection token representing the {@link ISessionPort} contract.
 */
export const TOKEN_SESSION_PORT = Symbol();

/**
 * Authoritative session metadata used to sign credentials without changing identity or deadlines.
 */
export type SessionRegistration = SessionIdentity & {
    /**
     * Account version stamped into the issued token pair.
     */
    readonly sessionVersion: number;

    /**
     * Owning principal context.
     */
    readonly principalType: PrincipalType;

    /**
     * Current refresh credential identifier.
     */
    readonly refreshTokenJti: string;

    /**
     * Refresh credential expiry in Unix seconds.
     */
    readonly refreshExpiresAt: number;
};

/**
 * Request replay outcomes shared by pre-reads and atomic session mutations.
 */
export enum ReplaySessionOutcome {
    /**
     * No retained success exists; normal preparation may proceed.
     */
    NOT_FOUND = 'REPLAY_NOT_FOUND',

    /**
     * The original winning registration is still live.
     */
    REPLAYED = 'REPLAY_REPLAYED',

    /**
     * The request key belongs to a different fingerprint.
     */
    CONFLICT = 'REPLAY_CONFLICT',

    /**
     * The account version floor is missing, so session validity cannot be established.
     */
    SESSION_UNAVAILABLE = 'REPLAY_SESSION_UNAVAILABLE',

    /**
     * The session or request version is below the stored account version floor.
     */
    VERSION_SUPERSEDED = 'REPLAY_VERSION_SUPERSEDED',

    /**
     * The original registration is missing, expired, or has a different current refresh credential.
     */
    REPLAY_UNAVAILABLE = 'REPLAY_REPLAY_UNAVAILABLE',
}

/**
 * Retained request decision without creating a session or renewing retention.
 */
export type ReplaySessionResult =
    | {
          /**
           * The retained success can issue credentials.
           */
          readonly outcome: ReplaySessionOutcome.REPLAYED;

          /**
           * Original winning live registration.
           */
          readonly session: SessionRegistration;

          /**
           * Access credential expiry for this issuance in Unix seconds.
           */
          readonly accessExpiresAt: number;
      }
    | {
          /**
           * Normal preparation is needed, or replay is refused.
           */
          readonly outcome: Exclude<ReplaySessionOutcome, ReplaySessionOutcome.REPLAYED>;

          /**
           * No issuable registration accompanies this decision.
           */
          readonly session: null;

          /**
           * No credential deadline accompanies this decision.
           */
          readonly accessExpiresAt?: never;
      };

/**
 * Outcomes produced by new-session creation after replay checks.
 */
export enum OpenSessionOutcome {
    /**
     * A new session was opened and can issue credentials.
     */
    OPENED = 'OPEN_OPENED',

    /**
     * The new-session snapshot is below the stored version floor.
     */
    VERSION_SUPERSEDED = 'OPEN_VERSION_SUPERSEDED',
}

/**
 * Opening decision with registration metadata only for successful issuance.
 */
export type OpenSessionResult =
    | Extract<ReplaySessionResult, { readonly outcome: ReplaySessionOutcome.REPLAYED }>
    | {
          /**
           * The newly opened session can issue credentials.
           */
          readonly outcome: OpenSessionOutcome.OPENED;

          /**
           * Original winning live registration.
           */
          readonly session: SessionRegistration;

          /**
           * Access credential expiry selected for this issuance in Unix seconds.
           */
          readonly accessExpiresAt: number;
      }
    | {
          /**
           * Request conflict or session-domain rejection decision.
           */
          readonly outcome:
              | Exclude<OpenSessionOutcome, OpenSessionOutcome.OPENED>
              | Exclude<ReplaySessionOutcome, ReplaySessionOutcome.NOT_FOUND | ReplaySessionOutcome.REPLAYED>;

          /**
           * Rejected decisions cannot issue credentials.
           */
          readonly session: null;

          /**
           * Rejected decisions have no credential deadline.
           */
          readonly accessExpiresAt?: never;
      };

/**
 * Outcomes produced by credential rotation after replay checks.
 */
export enum RotateSessionOutcome {
    /**
     * Current refresh credential was atomically replaced while preserving the session deadline.
     */
    ROTATED = 'ROTATE_ROTATED',

    /**
     * Already-rotated credential was replayed within grace; rotation was denied without closing the session.
     */
    CONCURRENT_REPLAY = 'ROTATE_CONCURRENT_REPLAY',

    /**
     * Non-current credential was reused outside grace; the session was atomically closed.
     */
    REUSE_DETECTED = 'ROTATE_REUSE_DETECTED',

    /**
     * The account version floor is missing, so session validity cannot be established.
     */
    SESSION_UNAVAILABLE = 'ROTATE_SESSION_UNAVAILABLE',

    /**
     * The session or request version is below the stored account version floor.
     */
    VERSION_SUPERSEDED = 'ROTATE_VERSION_SUPERSEDED',

    /**
     * Rotation was denied because the session is missing or expired.
     */
    SESSION_CLOSED = 'ROTATE_SESSION_CLOSED',
}

/**
 * Rotation decision with registration metadata only for successful issuance.
 */
export type RotateSessionResult =
    | Extract<ReplaySessionResult, { readonly outcome: ReplaySessionOutcome.REPLAYED }>
    | {
          /**
           * The newly rotated session can issue credentials.
           */
          readonly outcome: RotateSessionOutcome.ROTATED;

          /**
           * Original winning live registration.
           */
          readonly session: SessionRegistration;

          /**
           * Access credential expiry selected for this issuance in Unix seconds.
           */
          readonly accessExpiresAt: number;
      }
    | {
          /**
           * Existing session-domain rejection decision.
           */
          readonly outcome:
              | Exclude<RotateSessionOutcome, RotateSessionOutcome.ROTATED>
              | Exclude<ReplaySessionOutcome, ReplaySessionOutcome.NOT_FOUND | ReplaySessionOutcome.REPLAYED>;

          /**
           * Rejected decisions cannot issue credentials.
           */
          readonly session: null;

          /**
           * Rejected decisions have no credential deadline.
           */
          readonly accessExpiresAt?: never;
      };

/**
 * Session mutations own identity and deadlines; token signing follows the atomic session decision.
 */
export interface ISessionPort {
    /**
     * Opens a session or replays the original live registration in one atomic operation.
     * Identity and deadlines are created only after the request replay decision.
     *
     * @param idempotencyRequest Logical request identity.
     * @param id Principal identifier.
     * @param principalType Owning context.
     * @param sessionVersion Current account version.
     * @returns Opening decision, winning registration and per-issuance access expiry on success.
     * @throws {DependencyUnavailableException} When the session store is unavailable.
     * @throws {SystemException} When the store returns an unsupported opening result.
     */
    openSession(
        idempotencyRequest: IdempotencyRequest,
        id: string,
        principalType: PrincipalType,
        sessionVersion: number,
    ): Promise<OpenSessionResult>;

    /**
     * Reads retained request success before preparation, without changing session or request state.
     * Mutation methods recheck replay atomically; this read does not wait for in-flight requests.
     *
     * @param idempotencyRequest Logical request identity and canonical input.
     * @param principalId Principal identifier used to locate the request.
     * @param principalType Owning context.
     * @returns Missing request, conflict, unavailable replay, or the original live registration.
     * @throws {DependencyUnavailableException} When the session store is unavailable.
     * @throws {SystemException} When the store returns an unsupported replay result.
     */
    findSessionRequestReplay(
        idempotencyRequest: IdempotencyRequest,
        principalId: string,
        principalType: PrincipalType,
    ): Promise<ReplaySessionResult>;

    /**
     * Replays request success or rotates the current credential in one atomic operation.
     * Reuse outside grace closes that session before returning.
     *
     * @param idempotencyRequest Logical request identity.
     * @param id Principal identifier.
     * @param oldJti Presented refresh credential identifier.
     * @param session Current account version and verified session identity to preserve.
     * @returns Rotation decision, winning registration and per-issuance access expiry on success.
     * @throws {DependencyUnavailableException} When the session store is unavailable.
     * @throws {SystemException} When the store returns an unsupported rotation result.
     */
    rotateSession(
        idempotencyRequest: IdempotencyRequest,
        id: string,
        oldJti: string,
        session: Omit<SessionRegistration, 'refreshTokenJti' | 'refreshExpiresAt'>,
    ): Promise<RotateSessionResult>;

    /**
     * Deletes the stable session; rotation never recreates missing sessions.
     *
     * @param id Principal identifier.
     * @param principalType Owning context.
     * @param sid Verified session identifier, independent of credential rotation.
     * @throws {DependencyUnavailableException} When the session store is unavailable.
     */
    closeSession(id: string, principalType: PrincipalType, sid: string): Promise<void>;

    /**
     * Checks the account floor and session liveness in one atomic store read.
     *
     * @param id Principal identifier.
     * @param principalType Owning context.
     * @param sid Verified session identifier.
     * @param version Access token version.
     * @returns Whether both checks admit this access token.
     * @throws {DependencyUnavailableException} When the session store is unavailable.
     */
    isSessionActive(id: string, principalType: PrincipalType, sid: string, version: number): Promise<boolean>;

    /**
     * Advances the account access floor monotonically and renews its independent retention.
     *
     * @param id Principal identifier.
     * @param principalType Owning context.
     * @param version Candidate access floor.
     * @throws {DependencyUnavailableException} When the session store is unavailable.
     */
    setVersion(id: string, principalType: PrincipalType, version: number): Promise<void>;

    /**
     * Reads the account access floor without an accepting default.
     *
     * @param id Principal identifier.
     * @param principalType Owning context.
     * @returns Stored floor or null.
     * @throws {DependencyUnavailableException} When the session store is unavailable.
     */
    getVersion(id: string, principalType: PrincipalType): Promise<number | null>;
}
