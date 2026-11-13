/**
 * @file access-token-lifetime-policy.ts
 * @description Bounds access credentials by their configured lifetime and the winning refresh deadline.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ENV, parseTtlToSeconds } from 'src/core/config';
import { nowEpochSeconds } from 'src/shared/time';

/**
 * Owns access-token lifetime policy independently of session persistence.
 */
@Injectable()
export class AccessTokenLifetimePolicy {
    /**
     * Configured maximum access credential lifetime in seconds.
     */
    private readonly accessTtlSeconds: number;

    /**
     * Reads the boot-validated access lifetime.
     *
     * @param configService Supplies the access-token TTL.
     */
    constructor(configService: ConfigService) {
        this.accessTtlSeconds = parseTtlToSeconds(configService.getOrThrow<string>(ENV.JWT_ACCESS_TTL));
    }

    /**
     * Caps access expiry by refresh expiry, which session authority bounds by absolute expiry.
     *
     * @param refreshExpiresAt Winning refresh deadline in Unix seconds.
     * @returns Access credential deadline in Unix seconds.
     */
    getAccessExpiresAt(refreshExpiresAt: number): number {
        return Math.min(nowEpochSeconds() + this.accessTtlSeconds, refreshExpiresAt);
    }
}
