/**
 * @file hashing.port.ts
 * @description Contract and injection token of the hashing concern.
 */

/**
 * Dependency injection token representing the {@link IHashingPort} contract.
 */
export const TOKEN_HASHING_PORT = Symbol();

/**
 * Contract for password hashing and context-separated keyed digests.
 */
export interface IHashingPort {
    /**
     * Hashes a password with Argon2id.
     *
     * @param plainText The string to hash.
     * @returns The hash string.
     */
    hashPassword(plainText: string): Promise<string>;

    /**
     * Verifies a password against an encoded Argon2 hash.
     *
     * @param hash The hash to verify against.
     * @param plainText The plain text to verify.
     * @returns Whether the plain text matches the hash — a mismatch resolves to false, never throws.
     * @throws {Error} The raw driver error when the stored hash is not a valid encoding.
     */
    verifyPassword(hash: string, plainText: string): Promise<boolean>;

    /**
     * Spends the time a `verifyPassword` against a stored hash would, without a stored hash.
     *
     * For a rejection decided before the password is verified (unknown email, pending or banned
     * account), so response time does not say why the attempt failed.
     *
     * @param plainText The plain text the caller would have verified.
     */
    simulatePasswordVerify(plainText: string): Promise<void>;

    /**
     * Produces a deterministic HMAC-SHA-256 digest with the server-held hashing key.
     * Context and value are encoded as a JSON pair; callers own value canonicalization.
     *
     * @param context Caller-owned purpose separating digest domains.
     * @param value Canonical value to digest, interpreted as UTF-8 text.
     * @returns The 64-character lowercase hexadecimal digest.
     */
    hmacSha256(context: string, value: string): string;
}
