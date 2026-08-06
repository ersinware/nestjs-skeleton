/**
 * @file hashing.adapter.ts
 * @description Argon2 adapter implementing the hashing port.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { ENV, Environment } from 'src/core/config';
import type { IHashingPort } from 'src/core/security/hashing/port/hashing.port';

/**
 * Hashes and verifies passwords with Argon2id.
 */
@Injectable()
export class HashingAdapter implements IHashingPort {
    /**
     * Low-cost Argon2 parameters, set only under `NODE_ENV=test` to prevent CPU starvation in
     * E2E and fuzzing runs; undefined otherwise, so production hashing uses the library defaults.
     */
    private readonly hashOptions?: argon2.Options;

    /**
     * @param configService Source of the environment deciding the Argon2 cost parameters.
     */
    constructor(configService: ConfigService) {
        if (configService.getOrThrow<Environment>(ENV.NODE_ENV) === Environment.TEST) {
            this.hashOptions = {
                timeCost: 1,
                memoryCost: 8,
                parallelism: 1,
            };
        }
    }

    /**
     * Hashes a plain text string with Argon2id.
     *
     * @param plainText The string to hash.
     * @returns The Argon2 hash string.
     */
    async hash(plainText: string): Promise<string> {
        return this.hashOptions ? argon2.hash(plainText, this.hashOptions) : argon2.hash(plainText);
    }

    /**
     * Verifies a plain text string against an Argon2 hash.
     *
     * @param hash The Argon2 hash to verify against.
     * @param plainText The plain text to verify.
     * @returns Whether the plain text matches the hash.
     */
    async verify(hash: string, plainText: string): Promise<boolean> {
        return argon2.verify(hash, plainText);
    }
}
