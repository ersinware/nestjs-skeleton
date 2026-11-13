/**
 * @file access-token-lifetime-policy.spec.ts
 * @description Verifies access token lifetime calculation and refresh-deadline capping.
 */

import { ConfigService } from '@nestjs/config';
import { ENV } from 'src/core/config';
import { AccessTokenLifetimePolicy } from 'src/core/security/auth/access-token-lifetime-policy';
import { nowEpochSeconds } from 'src/shared/time';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('AccessTokenLifetimePolicy', () => {
    let policy: AccessTokenLifetimePolicy;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-13T00:00:00.500Z'));
        policy = new AccessTokenLifetimePolicy({
            getOrThrow: (key: string) => ({ [ENV.JWT_ACCESS_TTL]: '15m' })[key],
        } as unknown as ConfigService);
    });

    afterEach(() => vi.useRealTimers());

    it('returns now + accessTtlSeconds when the refresh deadline is later', () => {
        const now = nowEpochSeconds();
        const refreshExpiresAt = now + 3600;

        expect(policy.getAccessExpiresAt(refreshExpiresAt)).toBe(now + 900);
    });

    it('caps access expiry at the winning refresh deadline', () => {
        const now = nowEpochSeconds();
        const refreshExpiresAt = now + 300;

        expect(policy.getAccessExpiresAt(refreshExpiresAt)).toBe(refreshExpiresAt);
    });
});
