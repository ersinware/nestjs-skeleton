/**
 * @file hashing.adapter.ts
 * @description Password hashing and context-separated HMAC adapter.
 */

import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHmac, randomBytes } from 'node:crypto';
import { ENV, Environment } from 'src/core/config';
import type { IHashingPort } from 'src/core/security/hashing/port/hashing.port';

/**
 * Hashes passwords with Argon2id and produces keyed HMAC-SHA-256 digests.
 */
@Injectable()
export class HashingAdapter implements IHashingPort, OnModuleInit {
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
     * Server-held UTF-8 key shared by context-separated HMAC operations.
     */
    private readonly hashingKey: string;

    /**
     * Hash of a random secret, verified against by `simulatePasswordVerify`.
     *
     * Built here rather than hard-coded so it always carries the current cost parameters: Argon2
     * reads them from the encoded hash, so only a hash produced with the same options costs the same
     * time as a stored one.
     */
    private placeholderHash!: string;

    /**
     * Loads the HMAC key and selects the environment-specific password hashing cost.
     *
     * @param configService Source of the validated hashing key and runtime environment.
     */
    constructor(configService: ConfigService) {
        this.hashingKey = configService.getOrThrow<string>(ENV.HASHING_KEY);
        this.hashOptions =
            configService.getOrThrow<Environment>(ENV.NODE_ENV) === Environment.TEST
                ? { timeCost: 1, memoryCost: 8, parallelism: 1 }
                : { timeCost: 2, memoryCost: 19456, parallelism: 1 };
    }

    /**
     * Derives the placeholder hash once at boot, so no login pays for it.
     */
    async onModuleInit() {
        this.placeholderHash = await argon2.hash(randomBytes(32), this.hashOptions);
    }

    /**
     * Hashes a plain text string with Argon2id.
     *
     * @param plainText The string to hash.
     * @returns The Argon2 hash string.
     */
    async hashPassword(plainText: string): Promise<string> {
        return argon2.hash(plainText, this.hashOptions);
    }

    /**
     * Verifies a plain text string against an Argon2 hash.
     *
     * @param hash The Argon2 hash to verify against.
     * @param plainText The plain text to verify.
     * @returns Whether the plain text matches the hash.
     */
    async verifyPassword(hash: string, plainText: string): Promise<boolean> {
        return argon2.verify(hash, plainText);
    }

    /**
     * Verifies against the placeholder hash and discards the result, which is false by construction.
     *
     * @param plainText The plain text the caller would have verified.
     */
    async simulatePasswordVerify(plainText: string) {
        await argon2.verify(this.placeholderHash, plainText);
    }

    /**
     * Separates digest purposes using an unambiguous context/value encoding.
     *
     * @param context Caller-owned digest purpose.
     * @param value Canonical UTF-8 value.
     * @returns The lowercase hexadecimal HMAC-SHA-256 digest.
     */
    hmacSha256(context: string, value: string): string {
        return createHmac('sha256', this.hashingKey)
            .update(JSON.stringify([context, value]), 'utf8')
            .digest('hex');
    }
}
