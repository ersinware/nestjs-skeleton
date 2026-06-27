/**
 * @file identity-provider.interface.ts
 * @description Contract for services (e.g., UserService, AdminService) that provide identity lookup for authentication.
 */

import type { IAuthIdentity } from './auth-identity.interface';

/**
 * Contract for identity provider services injected into the AuthModule.
 * Allows the module to interact with arbitrary user domains without coupling to their specific implementations.
 *
 * @template T The specific type of identity returned, defaulting to IAuthIdentity.
 */
export interface IIdentityProvider<T extends IAuthIdentity = IAuthIdentity> {
    /**
     * Looks up an identity strictly by their email address.
     *
     * @param email The email address to search for
     * @returns The associated identity
     * @throws {NotFoundException} If no identity is found
     */
    findByEmail(email: string): Promise<T>;

    /**
     * Retrieves a specific identity by their unique identifier.
     *
     * @param id The unique identifier of the target identity
     * @returns The associated identity
     * @throws {NotFoundException} If no identity is found
     */
    findById(id: string): Promise<T>;
}
