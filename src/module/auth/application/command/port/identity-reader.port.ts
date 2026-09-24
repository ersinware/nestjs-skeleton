/**
 * @file identity-reader.port.ts
 * @description Contract for looking up an authenticatable identity, from whichever bounded context owns it.
 */

import type { Permission, PrincipalType } from 'src/shared/domain/principal';

/**
 * Dependency injection token representing the {@link IIdentityReaderPort} contract.
 */
export const TOKEN_IDENTITY_READER_PORT = Symbol();

/**
 * The identity contract required by the AuthModule.
 * Decouples authentication logic from specific domain entities.
 */
export type AuthIdentity = {
    /**
     * The unique identifier of the identity
     */
    readonly id: string;

    /**
     * The hashed password of the identity, or null while the account is pending activation
     */
    readonly password: string | null;

    /**
     * The permissions the identity currently holds, embedded into freshly minted access tokens
     */
    readonly permissions: readonly Permission[];

    /**
     * The ban status of the identity
     */
    readonly isBanned: boolean;

    /**
     * The current session version, embedded into freshly minted tokens
     */
    readonly sessionVersion: number;
};

/**
 * The slice of an identity the refresh flow re-reads on every rotation: enough to reject a banned
 * account or a refresh token minted before the last full revocation, plus the version to mint the
 * new pair at and the permissions the fresh access token must carry. Derived from
 * {@link AuthIdentity} so the two contracts cannot drift apart; `revocationVersion` is refresh's
 * alone, since login always mints at the current version.
 */
export type AuthState = Pick<AuthIdentity, 'permissions' | 'isBanned' | 'sessionVersion'> & {
    /**
     * The session version of the last full revocation; a refresh token below it is dead
     */
    readonly revocationVersion: number;
};

/**
 * The single read surface authentication needs over every kind of principal.
 *
 * One port rather than one per kind: the kind is a parameter of the lookup, so a handler that
 * resolves it at runtime (token refresh) depends on one contract instead of branching across two,
 * and a new kind is added in the adapter rather than in every handler.
 */
export interface IIdentityReaderPort {
    /**
     * Looks up an identity of the given kind strictly by its email address.
     *
     * @param principalType The bounded context that owns the identity
     * @param email The email address to search for
     * @returns The associated identity
     * @throws {ResourceNotFoundException} If no identity is found
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getCredentialsByEmail(principalType: PrincipalType, email: string): Promise<AuthIdentity>;

    /**
     * Retrieves an identity's ban status, session counters and permissions by its unique identifier.
     *
     * @param principalType The bounded context that owns the identity
     * @param id The unique identifier of the target identity
     * @returns The ban status, session counters and permissions
     * @throws {ResourceNotFoundException} If no identity is found
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getAuthState(principalType: PrincipalType, id: string): Promise<AuthState>;
}
