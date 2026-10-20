/**
 * @file handler.spec.ts
 * @description Verifies state-bound profile upload issuance without profile writes.
 */

import { ConfigService } from '@nestjs/config';
import { ENV } from 'src/core/config';
import type { ITokenPort } from 'src/core/security/token';
import type { IStoragePort } from 'src/core/storage';
import { InitiateUserAvatarChangeCommand } from 'src/module/user/application/command/initiate-user-avatar-change/command';
import { InitiateUserAvatarChangeCommandHandler } from 'src/module/user/application/command/initiate-user-avatar-change/handler';
import { User } from 'src/module/user/domain/aggregate/user.aggregate';
import { createUserAvatarChangeFormHash } from 'src/module/user/domain/user-avatar-change';
import { buildUserPendingAvatarKey, buildUserPermanentAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import { UserUploadPurpose } from 'src/module/user/domain/user-upload-purpose.enum';
import { ExceptionKind } from 'src/shared/exception';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('InitiateUserAvatarChangeCommandHandler', () => {
    afterEach(() => vi.useRealTimers());

    it.each(['active', 'banned', 'pending'] as const)('checks %s eligibility before signing', async (state) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-07T08:00:00Z'));
        const now = Math.floor(Date.now() / 1000);
        const id = '019a3b7c-8d42-7e19-9a65-c3f821b6d047';
        const currentAvatarKey = buildUserPermanentAvatarKey(id, 'c116ffde-c006-4b3f-902c-e658d6ad4142');
        const user = User.reconstitute({
            ...User.create({
                id,
                email: 'user@example.test',
                name: 'User',
                password: 'hash',
                avatarKey: buildUserPendingAvatarKey(id, id),
            }).toSnapshot(),
            activationId: state === 'pending' ? 'pending-activation' : null,
            activationExpiresAt: null,
            activationRevocationVersion: null,
            avatarKey: currentAvatarKey,
            isBanned: state === 'banned',
        });
        const before = user.toSnapshot();
        const avatar = { sizeBytes: 4, contentType: 'image/png' } as const;
        const request = {
            url: 'https://storage.example.test/upload',
            headers: {},
            expiresAt: new Date((now + 300) * 1000),
        };
        const initiateUpload = vi.fn<IStoragePort['initiateUpload']>().mockResolvedValue({ mode: 'single', request });
        const generateUploadToken = vi.fn<ITokenPort['generateUploadToken']>().mockResolvedValue('proof');
        const save = vi.fn();
        const handler = new InitiateUserAvatarChangeCommandHandler(
            { load: vi.fn().mockResolvedValue(user), save, loadByEmail: vi.fn(), insert: vi.fn() },
            { generateUploadToken } as unknown as ITokenPort,
            { initiateUpload } as unknown as IStoragePort,
            new ConfigService({ [ENV.JWT_UPLOAD_SECRET]: 'upload-secret' }),
            { record: vi.fn().mockResolvedValue(undefined) },
        );
        const result = handler.execute(new InitiateUserAvatarChangeCommand(id, avatar, 'New User'));
        if (state !== 'active') {
            await expect(result).rejects.toMatchObject({
                kind: state === 'banned' ? ExceptionKind.ACCESS_DENIED : ExceptionKind.SYSTEM,
            });
            expect(initiateUpload).not.toHaveBeenCalled();
            expect(generateUploadToken).not.toHaveBeenCalled();
        } else {
            expect(await result).toEqual({ mode: 'single', request, uploadToken: 'proof' });
            const proof = generateUploadToken.mock.calls[0]![0];
            expect(proof).toMatchObject({
                sub: id,
                revocationVersion: 0,
                purpose: UserUploadPurpose.PROFILE_AVATAR,
                exp: now + 600,
                fileKey: buildUserPendingAvatarKey(id, proof.jti),
            });
            expect(proof.formHash).toBe(
                createUserAvatarChangeFormHash(
                    {
                        id,
                        avatarId: proof.jti,
                        name: 'New User',
                        avatar,
                    },
                    'upload-secret',
                ),
            );
            expect(initiateUpload).toHaveBeenCalledExactlyOnceWith({
                key: proof.fileKey,
                ...avatar,
                cache: { visibility: 'no-store' },
                deadline: new Date((now + 300) * 1000),
            });
        }
        expect(user.toSnapshot()).toEqual(before);
        expect(user.pullJobs()).toEqual([]);
        expect(save).not.toHaveBeenCalled();
    });
});
