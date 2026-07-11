/**
 * @file user-identity-reader.port.ts
 * @description Contract for services that provide User identity lookup for authentication.
 */

export const TOKEN_USER_IDENTITY_READER_PORT = Symbol('TOKEN_USER_IDENTITY_READER_PORT');

/**
 * The user identity contract required by the AuthModule.
 * Decouples authentication logic from specific domain entities.
 */
export type AuthIdentity = {
    /** The unique identifier of the identity */
    id: string;

    /** The hashed password of the identity */
    password: string;

    /** The active status of the identity */
    isActive: boolean;
};

export interface IUserIdentityReaderPort {
    /**
     * Looks up a user strictly by their email address.
     *
     * @param email The email address to search for
     * @returns The associated user identity
     * @throws {ResourceNotFoundException} If no identity is found
     */
    getCredentialsByEmail(email: string): Promise<AuthIdentity>;

    /**
     * Retrieves a specific user identity by their unique identifier.
     *
     * @param id The unique identifier of the target identity
     * @returns True if active, false otherwise
     * @throws {ResourceNotFoundException} If no identity is found
     */
    checkIsActive(id: string): Promise<boolean>;
}
