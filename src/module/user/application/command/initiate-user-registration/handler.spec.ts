/**
 * @file handler.spec.ts
 * @description Verifies initiation deadlines, form binding, and authoritative email refusal.
 */

import type { IHashingPort } from 'src/core/security/hashing';
import { InitiateUserRegistrationCommand } from 'src/module/user/application/command/initiate-user-registration/command';
import { InitiateUserRegistrationCommandHandler } from 'src/module/user/application/command/initiate-user-registration/handler';
import { UserUploadTokenType } from 'src/module/user/application/user-upload-token';
import { buildUserPendingAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import { canonicalizeUserRegistrationForm } from 'src/module/user/domain/user-registration';
import { ExceptionKind } from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

describe('InitiateUserRegistrationCommandHandler', () => {
    it('binds an independent identity and form to a five-minute PUT and ten-minute proof', async () => {
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const email = { isEmailInUse: vi.fn().mockResolvedValue({ isInUse: false }) };
        const storage = {
            initiateUpload: vi.fn().mockResolvedValue({ mode: 'single', request: { url: 'signed-url' } }),
        };
        const token = { sign: vi.fn().mockResolvedValue('proof') };
        const hmacSha256 = vi.fn<IHashingPort['hmacSha256']>().mockReturnValue('form-digest');
        const handler = new InitiateUserRegistrationCommandHandler(
            email,
            storage as never,
            token as never,
            { hmacSha256 } as unknown as IHashingPort,
        );
        const command = new InitiateUserRegistrationCommand('avatar@example.test', 'Avatar', 'Password!123', {
            sizeBytes: 4,
            contentType: 'image/png',
        });
        await handler.execute(command);
        const claims = token.sign.mock.calls[0]![1] as { sub: string; jti: string };
        expect(claims.sub).toMatch(/^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
        expect(claims.jti).not.toBe(claims.sub);
        expect(token.sign).toHaveBeenCalledWith(
            UserUploadTokenType.REGISTRATION,
            expect.objectContaining({
                fileKey: buildUserPendingAvatarKey(claims.sub, claims.sub),
                exp: Math.floor(now / 1000) + 600,
                formHash: 'form-digest',
            }),
        );
        expect(hmacSha256).toHaveBeenCalledExactlyOnceWith(
            UserUploadTokenType.REGISTRATION,
            canonicalizeUserRegistrationForm({
                email: command.email,
                name: command.name,
                password: command.password,
                avatar: command.avatar,
            }),
        );
        expect(storage.initiateUpload).toHaveBeenCalledWith(
            expect.objectContaining({
                key: buildUserPendingAvatarKey(claims.sub, claims.sub),
                deadline: new Date((Math.floor(now / 1000) + 300) * 1000),
                cache: { visibility: 'no-store' },
            }),
        );
        email.isEmailInUse.mockResolvedValue({ isInUse: true });
        await expect(handler.execute(command)).rejects.toMatchObject({ kind: ExceptionKind.RESOURCE_CONFLICT });
        expect(storage.initiateUpload).toHaveBeenCalledTimes(1);
        expect(token.sign).toHaveBeenCalledTimes(1);
    });
});
