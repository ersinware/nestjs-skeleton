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
     * Argon2id cost parameters, chosen once at boot from the environment.
     *
     * Production runs the OWASP Password Storage Cheat Sheet minimum profile (19 MiB, 2 iterations,
     * 1 lane) rather than the library default (64 MiB, 3 iterations, 4 lanes): each concurrent login
     * holds `memoryCost` KiB for the whole hash, so the smaller profile keeps a memory-limited
     * container safe from OOM under a login burst while staying at the recommended security floor.
     * Under `NODE_ENV=test` the parameters drop to Argon2's absolute minimum to prevent CPU
     * starvation in E2E and fuzzing runs.
     */
    private readonly hashOptions: argon2.Options;

    /**
     * @param configService Source of the environment deciding the Argon2 cost parameters.
     */
    constructor(configService: ConfigService) {
        this.hashOptions =
            configService.getOrThrow<Environment>(ENV.NODE_ENV) === Environment.TEST
                ? { timeCost: 1, memoryCost: 8, parallelism: 1 }
                : { timeCost: 2, memoryCost: 19456, parallelism: 1 };
    }

    /**
     * Hashes a plain text string with Argon2id.
     *
     * @param plainText The string to hash.
     * @returns The Argon2 hash string.
     */
    async hash(plainText: string): Promise<string> {
        return argon2.hash(plainText, this.hashOptions);
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
