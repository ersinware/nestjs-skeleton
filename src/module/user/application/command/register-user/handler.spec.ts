/**
 * @file handler.spec.ts
 * @description Verifies registration refusal boundaries precede hashing and account persistence.
 */

import { ConfigService } from '@nestjs/config';
import { RegisterUserCommand } from 'src/module/user/application/command/register-user/command';
import { RegisterUserCommandHandler } from 'src/module/user/application/command/register-user/handler';
import { buildUserPendingAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import { createUserRegistrationFormHash } from 'src/module/user/domain/user-registration';
import { ExceptionKind, ResourceNotFoundException, UnauthenticatedException } from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

describe('RegisterUserCommandHandler', () => {
    const id = '019a3b7c-8d42-7e19-9a65-c3f821b6d047';
    const command = new RegisterUserCommand(
        'avatar@example.test',
        'Avatar',
        'Password!123',
        { sizeBytes: 4, contentType: 'image/png' },
        'proof',
    );
    const secret = 'test-upload-secret';

    function setup() {
        const claims = {
            sub: id,
            fileKey: buildUserPendingAvatarKey(id, id),
            formHash: createUserRegistrationFormHash(command, secret),
        };
        const token = { verifyUploadToken: vi.fn().mockResolvedValue(claims) };
        const storage = { headObject: vi.fn().mockResolvedValue({ sizeBytes: 4, contentType: 'image/png' }) };
        const writer = { insert: vi.fn() };
        const hashing = { hash: vi.fn().mockResolvedValue('hash') };
        const transaction = { run: vi.fn(async (callback: () => Promise<void>) => callback()) };
        const audit = { record: vi.fn() };
        const handler = new RegisterUserCommandHandler(
            transaction as never,
            writer as never,
            hashing as never,
            audit,
            token as never,
            storage as never,
            new ConfigService({ JWT_UPLOAD_SECRET: secret }),
        );
        return { handler, claims, token, storage, writer, hashing, transaction, audit };
    }

    it.each(['identity', 'key', 'missing', 'size', 'type', 'proof'] as const)(
        'rejects %s without hashing or writing',
        async (failure) => {
            const fixture = setup();
            let kind: ExceptionKind = ExceptionKind.INVALID_INPUT;
            switch (failure) {
                case 'identity':
                    fixture.claims.sub = 'invalid';
                    kind = ExceptionKind.SYSTEM;
                    break;
                case 'key':
                    fixture.claims.fileKey = 'another-key';
                    kind = ExceptionKind.SYSTEM;
                    break;
                case 'missing':
                    fixture.storage.headObject.mockRejectedValue(new ResourceNotFoundException());
                    break;
                case 'size':
                    fixture.storage.headObject.mockResolvedValue({ sizeBytes: 5, contentType: 'image/png' });
                    break;
                case 'type':
                    fixture.storage.headObject.mockResolvedValue({ sizeBytes: 4, contentType: 'image/jpeg' });
                    break;
                case 'proof':
                    fixture.token.verifyUploadToken.mockRejectedValue(new UnauthenticatedException());
                    kind = ExceptionKind.INVALID_INPUT;
                    break;
            }
            await expect(fixture.handler.execute(command)).rejects.toMatchObject({ kind });
            expect(fixture.hashing.hash).not.toHaveBeenCalled();
            expect(fixture.writer.insert).not.toHaveBeenCalled();
            expect(fixture.transaction.run).not.toHaveBeenCalled();
            expect(fixture.audit.record).not.toHaveBeenCalled();
        },
    );
});
