/**
 * @file port.ts
 * @description Contract and tokens for the HashingService.
 */

export const TOKEN_HASHING_PORT = Symbol('TOKEN_HASHING_PORT');

/**
 * Contract for hashing plain text and verifying it against stored hashes.
 */
export interface IHashingPort {
    /**
     * Hashes a plain text string.
     *
     * @param plainText The string to hash.
     * @returns A promise resolving to the hash string.
     */
    hash(plainText: string): Promise<string>;

    /**
     * Verifies a plain text string against a hash.
     *
     * @param hash The hash string to verify against.
     * @param plainText The plain text string to verify.
     * @returns A promise resolving to a boolean indicating verification status.
     * @throws {Error} The raw argon2 error when the stored hash is not a valid Argon2 encoding —
     * a mismatch resolves to false, never throws.
     */
    verify(hash: string, plainText: string): Promise<boolean>;
}
