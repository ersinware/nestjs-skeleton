/**
 * @file session.port.ts
 * @description Atomic session lifecycle and account-wide access-version contracts.
 */

import type { SessionIdentity } from 'src/core/security/session/session-identity.type';
import type { PrincipalType } from 'src/shared/domain/principal';

/**
 * Dependency injection token representing the {@link ISessionPort} contract.
 */
export const TOKEN_SESSION_PORT = Symbol();

/** Signed token metadata used to register exactly the lifetime issued by the token port. */
export type SessionRegistration = SessionIdentity & {
    /** Account version stamped into the issued token pair. */
    readonly sessionVersion: number;

    /** Owning principal context. */
    readonly principalType: PrincipalType;

    /** Current refresh credential identifier. */
    readonly refreshTokenJti: string;

    /** Refresh credential expiry in Unix seconds. */
    readonly refreshExpiresAt: number;
};

/** Rotation outcomes distinguish a dead session from reuse within a live session. */
export enum RotateOutcome {
    /** Current refresh credential was atomically replaced while preserving the session deadline. */
    ROTATED = 'ROTATED',

    /** Already-rotated credential was replayed within grace; rotation was denied without closing the session. */
    CONCURRENT_REPLAY = 'CONCURRENT_REPLAY',

    /** Non-current credential was reused outside grace; the session was atomically closed. */
    REUSE_DETECTED = 'REUSE_DETECTED',

    /** Rotation was denied because the session is missing, expired, or fails deadline/version checks. */
    SESSION_CLOSED = 'SESSION_CLOSED',
}

/** Session mutations accept token-generated registrations and are awaited before returning credentials or logout success. */
export interface ISessionPort {
    /**
     * Opens a new session and mirrors its version atomically; never replaces an existing sid.
     * @param id Principal identifier.
     * @param session Signed token lifetimes, identity, and account version.
     * @returns False if superseded or already registered.
     * @throws {DependencyUnavailableException} When the session store is unavailable.
     */
    openSession(id: string, session: SessionRegistration): Promise<boolean>;

    /**
     * Replaces only the current credential of an existing live session, preserving its deadline.
     * Reuse outside grace closes that session in the same operation before returning.
     * @param id Principal identifier.
     * @param oldJti Presented refresh credential identifier.
     * @param session Replacement credential with the original session identity.
     * @returns The atomic rotation decision.
     * @throws {DependencyUnavailableException} When the session store is unavailable.
     */
    rotateSession(id: string, oldJti: string, session: SessionRegistration): Promise<RotateOutcome>;

    /**
     * Deletes the stable session; rotation never recreates missing sessions.
     * @param id Principal identifier.
     * @param principalType Owning context.
     * @param sid Verified session identifier, independent of credential rotation.
     * @throws {DependencyUnavailableException} When the session store is unavailable.
     */
    closeSession(id: string, principalType: PrincipalType, sid: string): Promise<void>;

    /**
     * Checks the account floor and session liveness in one atomic store read.
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
     * @param id Principal identifier.
     * @param version Candidate access floor.
     * @throws {DependencyUnavailableException} When the session store is unavailable.
     */
    setVersion(id: string, version: number): Promise<void>;

    /**
     * Reads the account access floor without an accepting default.
     * @param id Principal identifier.
     * @returns Stored floor or null.
     * @throws {DependencyUnavailableException} When the session store is unavailable.
     */
    getVersion(id: string): Promise<number | null>;
}
