/**
 * @file identity-reader.port.ts
 * @description Contract for looking up an authenticatable identity, from whichever bounded context owns it.
 */

import { AdminRole } from 'src/shared/domain/admin';
import type { AuthRole } from 'src/shared/domain/auth-role';
import { UserRole } from 'src/shared/domain/user';
import { SystemException } from 'src/shared/exception';

/**
 * Dependency injection token representing the {@link IIdentityReaderPort} contract.
 */
export const TOKEN_IDENTITY_READER_PORT = Symbol('TOKEN_IDENTITY_READER_PORT');

/**
 * Which bounded context an identity is read from.
 *
 * This is the INPUT that selects the source, and it is deliberately not `AuthRole`: a login knows
 * the realm it authenticates against but not the role the account turns out to hold — an admin may
 * be `ADMIN` or `SUPER_ADMIN`. The role is what the realm REPORTS back, never what selects it.
 */
export enum IdentityRealm {
    USER = 'user',
    ADMIN = 'admin',
}

/**
 * Maps an authorization role back to the realm that owns its credentials — the inverse of what the
 * realm reports. Exhaustive over {@link AuthRole} so a newly added role fails compilation here
 * instead of silently routing to the wrong realm.
 *
 * @throws {SystemException} When the role is unroutable — a token minted with a role the enum no
 * longer (or never) carried, reachable only through a broken code path.
 */
export function realmOfRole(role: AuthRole): IdentityRealm {
    switch (role) {
        case UserRole.USER:
            return IdentityRealm.USER;
        case AdminRole.ADMIN:
        case AdminRole.SUPER_ADMIN:
            return IdentityRealm.ADMIN;
        default:
            return assertRoleExhausted(role);
    }
}

/**
 * Compile-time exhaustiveness guard for {@link realmOfRole}: reachable at runtime only through a
 * token minted with a role the enum no longer (or never) carried.
 *
 * @throws {SystemException} Always — an unroutable role is a broken code path, not a client fault.
 */
function assertRoleExhausted(role: never): never {
    throw new SystemException(`Unroutable authorization role: ${String(role)}`, {
        context: { class: realmOfRole.name, method: assertRoleExhausted.name },
    });
}

/**
 * The identity contract required by the AuthModule.
 * Decouples authentication logic from specific domain entities.
 */
export type AuthIdentity = {
    /** The unique identifier of the identity */
    id: string;

    /** The hashed password of the identity */
    password: string;

    /** The authorization role the owning realm reports, embedded into freshly minted tokens */
    role: AuthRole;

    /** The ban status of the identity */
    isBanned: boolean;

    /** The current session version, embedded into freshly minted tokens */
    sessionVersion: number;
};

/**
 * The slice of an identity the refresh flow re-reads on every rotation: just enough to reject a
 * banned account or a token carrying a stale version. Derived from {@link AuthIdentity} so the two
 * contracts cannot drift apart.
 */
export type AuthState = Pick<AuthIdentity, 'isBanned' | 'sessionVersion'>;

/**
 * The single read surface authentication needs over every identity realm.
 *
 * One port rather than one per realm: the realm is a parameter of the lookup, so a handler that
 * resolves it at runtime (token refresh) depends on one contract instead of branching across two,
 * and a new realm is added in the adapter rather than in every handler.
 */
export interface IIdentityReaderPort {
    /**
     * Looks up an identity in the given realm strictly by its email address.
     *
     * @param realm The bounded context that owns the identity
     * @param email The email address to search for
     * @returns The associated identity
     * @throws {ResourceNotFoundException} If no identity is found
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getCredentialsByEmail(realm: IdentityRealm, email: string): Promise<AuthIdentity>;

    /**
     * Retrieves an identity's ban status and current session version by its unique identifier.
     *
     * @param realm The bounded context that owns the identity
     * @param id The unique identifier of the target identity
     * @returns The ban status and current session version
     * @throws {ResourceNotFoundException} If no identity is found
     * @throws {DependencyUnavailableException} When the database is unreachable
     */
    getAuthState(realm: IdentityRealm, id: string): Promise<AuthState>;
}
