/**
 * @file hashing.service.ts
 * @description Service encapsulating password hashing and verification utilities.
 */

import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class HashingService {
    /**
     * Hashes a plain text string using Argon2id.
     *
     * @param plainText The string to hash.
     * @returns A promise resolving to the Argon2 hash string.
     */
    async hash(plainText: string): Promise<string> {
        return argon2.hash(plainText);
    }

    /**
     * Verifies a plain text string against an Argon2 hash.
     *
     * @param hash The Argon2 hash string to verify against.
     * @param plainText The plain text string to verify.
     * @returns A promise resolving to a boolean indicating verification status.
     */
    async verify(hash: string, plainText: string): Promise<boolean> {
        return argon2.verify(hash, plainText);
    }
}
