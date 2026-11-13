/**
 * @file module.spec.ts
 * @description Verifies EmailChangeModule DI wiring and dedicated secret binding.
 */

import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ENV } from 'src/core/config';
import {
    EMAIL_CONFIRMATION_TOKEN_TYPE,
    TOKEN_EMAIL_CONFIRMATION_TOKEN_PORT,
    type EmailConfirmationTokenPayload,
} from 'src/core/security/email-change/email-confirmation-token';
import { EmailChangeModule } from 'src/core/security/email-change/module';
import type { ITokenPort } from 'src/core/security/token';
import { PrincipalType } from 'src/shared/domain/principal';
import { nowEpochSeconds } from 'src/shared/time';
import { describe, expect, it } from 'vitest';

describe('EmailChangeModule', () => {
    it('exports the email confirmation token port bound to JWT_EMAIL_CONFIRM_SECRET', async () => {
        const module = await Test.createTestingModule({
            imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), EmailChangeModule],
        })
            .overrideProvider(ConfigService)
            .useValue({
                getOrThrow: (key: string) => ({ [ENV.JWT_EMAIL_CONFIRM_SECRET]: 'e'.repeat(32) })[key],
            })
            .compile();

        try {
            const port = module.get<ITokenPort<typeof EMAIL_CONFIRMATION_TOKEN_TYPE>>(
                TOKEN_EMAIL_CONFIRMATION_TOKEN_PORT,
            );
            const exp = nowEpochSeconds() + 600;
            const token = await port.sign<EmailConfirmationTokenPayload>(EMAIL_CONFIRMATION_TOKEN_TYPE, {
                sub: 'user-1',
                jti: 'req-1',
                principalType: PrincipalType.USER,
                emailRevocationVersion: 2,
                exp,
            });

            await expect(
                port.verify<EmailConfirmationTokenPayload>(token, EMAIL_CONFIRMATION_TOKEN_TYPE),
            ).resolves.toEqual({
                sub: 'user-1',
                jti: 'req-1',
                principalType: PrincipalType.USER,
                emailRevocationVersion: 2,
                exp,
                type: EMAIL_CONFIRMATION_TOKEN_TYPE,
            });
        } finally {
            await module.close();
        }
    });
});
