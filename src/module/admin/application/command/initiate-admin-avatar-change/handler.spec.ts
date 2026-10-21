/**
 * @file handler.spec.ts
 * @description Verifies state-bound profile upload issuance without profile writes.
 */

import { ConfigService } from '@nestjs/config';
import { ENV } from 'src/core/config';
import type { ITokenPort } from 'src/core/security/token';
import type { IStoragePort } from 'src/core/storage';
import { InitiateAdminAvatarChangeCommand } from 'src/module/admin/application/command/initiate-admin-avatar-change/command';
import { InitiateAdminAvatarChangeCommandHandler } from 'src/module/admin/application/command/initiate-admin-avatar-change/handler';
import { createAdminAvatarChangeFormHash } from 'src/module/admin/domain/admin-avatar-change';
import {
    buildAdminPendingAvatarKey,
    buildAdminPermanentAvatarKey,
} from 'src/module/admin/domain/admin-avatar-key.util';
import { AdminUploadPurpose } from 'src/module/admin/domain/admin-upload-purpose.enum';
import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import { ExceptionKind } from 'src/shared/exception';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('InitiateAdminAvatarChangeCommandHandler', () => {
    afterEach(() => vi.useRealTimers());

    it.each([false, true])('checks eligibility before signing (banned=%s)', async (isBanned) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-07T08:00:00Z'));
        const now = Math.floor(Date.now() / 1000);
        const id = '019a3b7c-8d42-7e19-9a65-c3f821b6d047';
        const currentAvatarKey = buildAdminPermanentAvatarKey(id, 'c116ffde-c006-4b3f-902c-e658d6ad4142');
        const admin = Admin.reconstitute({
            ...Admin.create({ id, email: 'admin@example.test', name: 'Admin' }).toSnapshot(),
            password: 'hash',
            inviteId: null,
            inviteExpiresAt: null,
            inviteRevocationVersion: null,
            avatarKey: currentAvatarKey,
            isBanned,
        });
        const before = admin.toSnapshot();
        const avatar = { sizeBytes: 4, contentType: 'image/png' } as const;
        const request = {
            url: 'https://storage.example.test/upload',
            headers: {},
            expiresAt: new Date((now + 300) * 1000),
        };
        const initiateUpload = vi.fn<IStoragePort['initiateUpload']>().mockResolvedValue({ mode: 'single', request });
        const generateUploadToken = vi.fn<ITokenPort['generateUploadToken']>().mockResolvedValue('proof');
        const save = vi.fn();
        const handler = new InitiateAdminAvatarChangeCommandHandler(
            { load: vi.fn().mockResolvedValue(admin), save },
            { generateUploadToken } as unknown as ITokenPort,
            { initiateUpload } as unknown as IStoragePort,
            new ConfigService({ [ENV.JWT_UPLOAD_SECRET]: 'upload-secret' }),
            { record: vi.fn().mockResolvedValue(undefined) },
        );
        const result = handler.execute(new InitiateAdminAvatarChangeCommand(id, avatar, 'New Admin'));
        if (isBanned) {
            await expect(result).rejects.toMatchObject({ kind: ExceptionKind.ACCESS_DENIED });
            expect(initiateUpload).not.toHaveBeenCalled();
            expect(generateUploadToken).not.toHaveBeenCalled();
        } else {
            expect(await result).toEqual({ mode: 'single', request, uploadToken: 'proof' });
            const proof = generateUploadToken.mock.calls[0]![0];
            expect(proof).toMatchObject({
                sub: id,
                purpose: AdminUploadPurpose.PROFILE_AVATAR,
                exp: now + 600,
                fileKey: buildAdminPendingAvatarKey(id, proof.jti),
            });
            expect(proof.formHash).toBe(
                createAdminAvatarChangeFormHash(
                    {
                        id,
                        avatarId: proof.jti,
                        name: 'New Admin',
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
        expect(admin.toSnapshot()).toEqual(before);
        expect(admin.pullJobs()).toEqual([]);
        expect(save).not.toHaveBeenCalled();
    });
});
