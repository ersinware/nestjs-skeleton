/**
 * @file module.spec.ts
 * @description Verifies token concern dependency injection bindings.
 */

import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TokenModule } from 'src/core/security/token/module';
import { TOKEN_TOKEN_PORT, type ITokenPort } from 'src/core/security/token/port/token.port';
import { describe, expect, it } from 'vitest';

describe('TokenModule', () => {
    it('exports upload signing and verification through the existing token port', async () => {
        const config = {
            SESSION_ABSOLUTE_TTL_ADMIN: '8h',
            SESSION_ABSOLUTE_TTL_USER: '7d',
            JWT_ACCESS_SECRET: 'a'.repeat(32),
            JWT_ACCESS_TTL: '15m',
            JWT_REFRESH_SECRET: 'r'.repeat(32),
            JWT_REFRESH_TTL: '1d',
            JWT_INVITE_SECRET: 'i'.repeat(32),
            JWT_USER_ACTIVATION_SECRET: 'u'.repeat(32),
            JWT_UPLOAD_SECRET: 'p'.repeat(32),
            JWT_EMAIL_CONFIRM_SECRET: 'e'.repeat(32),
        };
        const module = await Test.createTestingModule({
            imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), TokenModule],
        })
            .overrideProvider(ConfigService)
            .useValue(new ConfigService(config))
            .compile();

        try {
            const port = module.get<ITokenPort>(TOKEN_TOKEN_PORT);
            const claims = {
                sub: 'subject-1',
                jti: '12345678-1234-4234-8234-123456789abc',
                purpose: 'documents_upload',
                fileKey: 'pending/documents/subject-1',
                formHash: 'domain-owned-binding',
                exp: Math.floor(Date.now() / 1000) + 600,
            };
            const token = await port.generateUploadToken(claims);
            expect(await port.verifyUploadToken(token, claims.purpose)).toMatchObject(claims);
        } finally {
            await module.close();
        }
    });
});
