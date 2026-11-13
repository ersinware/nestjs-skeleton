/**
 * @file module.spec.ts
 * @description Verifies AuthPolicyModule DI exports and secret isolation between access and refresh token ports.
 */

import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ENV } from 'src/core/config';
import {
    ACCESS_TOKEN_TYPE,
    TOKEN_AUTH_ACCESS_TOKEN_PORT,
    type AccessTokenPayload,
} from 'src/core/security/auth/access-token';
import { AccessTokenLifetimePolicy } from 'src/core/security/auth/access-token-lifetime-policy';
import { AuthPolicyModule } from 'src/core/security/auth/module';
import {
    REFRESH_TOKEN_TYPE,
    TOKEN_AUTH_REFRESH_TOKEN_PORT,
    type RefreshTokenPayload,
} from 'src/core/security/auth/refresh-token';
import type { ITokenPort } from 'src/core/security/token';
import { PrincipalType } from 'src/shared/domain/principal';
import { UnauthenticatedException } from 'src/shared/exception';
import { nowEpochSeconds } from 'src/shared/time';
import { describe, expect, it } from 'vitest';

describe('AuthPolicyModule', () => {
    it('binds distinct secret-isolated token ports for access and refresh credentials', async () => {
        const module = await Test.createTestingModule({
            imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AuthPolicyModule],
        })
            .overrideProvider(ConfigService)
            .useValue({
                getOrThrow: (key: string) =>
                    ({
                        [ENV.JWT_ACCESS_SECRET]: 'a'.repeat(32),
                        [ENV.JWT_REFRESH_SECRET]: 'r'.repeat(32),
                        [ENV.JWT_ACCESS_TTL]: '15m',
                    })[key],
            })
            .compile();

        try {
            const accessPort = module.get<ITokenPort<typeof ACCESS_TOKEN_TYPE>>(TOKEN_AUTH_ACCESS_TOKEN_PORT);
            const refreshPort = module.get<ITokenPort<typeof REFRESH_TOKEN_TYPE>>(TOKEN_AUTH_REFRESH_TOKEN_PORT);
            const lifetimePolicy = module.get(AccessTokenLifetimePolicy);

            expect(lifetimePolicy).toBeInstanceOf(AccessTokenLifetimePolicy);

            const exp = nowEpochSeconds() + 600;
            const accessJwt = await accessPort.sign<AccessTokenPayload>(ACCESS_TOKEN_TYPE, {
                sub: 'user-1',
                sid: 'sid-1',
                principalType: PrincipalType.USER,
                permissions: [],
                sessionVersion: 1,
                exp,
            });
            const refreshJwt = await refreshPort.sign<RefreshTokenPayload>(REFRESH_TOKEN_TYPE, {
                sub: 'user-1',
                sid: 'sid-1',
                jti: 'jti-1',
                principalType: PrincipalType.USER,
                sessionVersion: 1,
                sessionExpiresAt: exp + 3600,
                exp,
            });

            await expect(accessPort.verify<AccessTokenPayload>(accessJwt, ACCESS_TOKEN_TYPE)).resolves.toMatchObject({
                sub: 'user-1',
                type: ACCESS_TOKEN_TYPE,
            });
            await expect(
                refreshPort.verify<RefreshTokenPayload>(refreshJwt, REFRESH_TOKEN_TYPE),
            ).resolves.toMatchObject({
                sub: 'user-1',
                type: REFRESH_TOKEN_TYPE,
            });

            // Cross-secret verification must fail even if the caller passes the other port's type.
            await expect(
                refreshPort.verify<RefreshTokenPayload>(
                    accessJwt,
                    ACCESS_TOKEN_TYPE as unknown as typeof REFRESH_TOKEN_TYPE,
                ),
            ).rejects.toThrow(UnauthenticatedException);
        } finally {
            await module.close();
        }
    });
});
