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

    /** The ban status of the identity */
    isBanned: boolean;

    /** The current session version, embedded into freshly minted tokens */
    version: number;
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
     * Retrieves a user's ban status and current session version by their unique identifier.
     *
     * @param id The unique identifier of the target identity
     * @returns The ban status and current session version
     * @throws {ResourceNotFoundException} If no identity is found
     */
    getAuthState(id: string): Promise<{ isBanned: boolean; version: number }>;
}
