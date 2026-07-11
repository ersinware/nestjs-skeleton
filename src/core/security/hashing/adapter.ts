/**
 * @file hashing.service.ts
 * @description Service encapsulating password hashing and verification utilities.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { ENV, Environment } from 'src/core/config';

import type { IHashingPort } from 'src/core/security/hashing/port';

/**
 * Service that encapsulates password hashing and verification using the Argon2 algorithm.
 */
@Injectable()
export class HashingPort implements IHashingPort {
    /**
     * Creates an instance of HashingService.
     *
     * @param configService Configuration reader client.
     */
    constructor(private readonly configService: ConfigService) {}

    /**
     * Hashes a plain text string using Argon2id.
     *
     * @param plainText The string to hash.
     * @returns A promise resolving to the Argon2 hash string.
     */
    async hash(plainText: string): Promise<string> {
        if (this.configService.getOrThrow<Environment>(ENV.NODE_ENV) === Environment.TEST) {
            // Use low-cost Argon2 parameters in test/CI environments, E2E tests, and during automated fuzzing
            // (Schemathesis) to prevent CPU starvation and maximize request throughput.
            return argon2.hash(plainText, {
                timeCost: 1,
                memoryCost: 8,
                parallelism: 1,
            });
        }

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
