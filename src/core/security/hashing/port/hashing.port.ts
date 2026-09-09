/**
 * @file hashing.port.ts
 * @description Contract and injection token of the hashing concern.
 */

/**
 * Dependency injection token representing the {@link IHashingPort} contract.
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
     * @returns The hash string.
     */
    hash(plainText: string): Promise<string>;

    /**
     * Verifies a plain text string against a hash.
     *
     * @param hash The hash to verify against.
     * @param plainText The plain text to verify.
     * @returns Whether the plain text matches the hash — a mismatch resolves to false, never throws.
     * @throws {Error} The raw driver error when the stored hash is not a valid encoding.
     */
    verify(hash: string, plainText: string): Promise<boolean>;

    /**
     * Spends the time a `verify` against a stored hash would, without a stored hash.
     *
     * For a rejection decided before the password is verified (unknown email, pending or banned
     * account), so response time does not say why the attempt failed.
     *
     * @param plainText The plain text the caller would have verified.
     */
    simulateVerify(plainText: string): Promise<void>;
}
