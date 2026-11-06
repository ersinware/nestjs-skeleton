/**
 * @file handler.spec.ts
 * @description Verifies invitation-bounded upload authorization without consuming invitation state.
 */

import type { IAuditPort } from 'src/core/observability/audit';
import type { IHashingPort } from 'src/core/security/hashing';
import type { ITokenPort } from 'src/core/security/token';
import type { IStoragePort } from 'src/core/storage';
import { InitiateAdminActivationCommand } from 'src/module/admin/application/command/initiate-admin-activation/command';
import { InitiateAdminActivationCommandHandler } from 'src/module/admin/application/command/initiate-admin-activation/handler';
import { canonicalizeAdminActivationForm } from 'src/module/admin/domain/admin-activation';
import { buildAdminPendingAvatarKey } from 'src/module/admin/domain/admin-avatar-key.util';
import { AdminUploadPurpose } from 'src/module/admin/domain/admin-upload-purpose.enum';
import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import { ExceptionKind } from 'src/shared/exception';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('InitiateAdminActivationCommandHandler', () => {
    afterEach(() => vi.useRealTimers());

    it.each([60, 3600])('caps the URL and proof at an invitation with %s seconds remaining', async (remaining) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-02T08:00:00Z'));
        const now = Math.floor(Date.now() / 1000);
        const admin = Admin.reconstitute({
            ...Admin.create({ id: 'admin', email: 'admin@example.test', name: 'Admin' }).toSnapshot(),
            inviteExpiresAt: new Date((now + remaining) * 1000),
        });
        admin.pullJobs();
        const before = admin.toSnapshot();
        const request = { url: 'https://storage.example.test/upload', headers: {}, expiresAt: new Date() };
        const initiateUpload = vi.fn<IStoragePort['initiateUpload']>().mockResolvedValue({ mode: 'single', request });
        const generateUploadToken = vi.fn<ITokenPort['generateUploadToken']>().mockResolvedValue('proof');
        const record = vi.fn<IAuditPort['record']>();
        const hmacSha256 = vi.fn<IHashingPort['hmacSha256']>().mockReturnValue('form-digest');
        const save = vi.fn();
        const handler = new InitiateAdminActivationCommandHandler(
            { load: vi.fn().mockResolvedValue(admin), save },
            {
                verifyInviteToken: vi.fn().mockResolvedValue({
                    sub: admin.id,
                    jti: admin.inviteId,
                    exp: now + remaining,
                    inviteRevocationVersion: admin.inviteRevocationVersion,
                }),
                generateUploadToken,
            } as unknown as ITokenPort,
            { initiateUpload } as unknown as IStoragePort,
            { record },
            { hmacSha256 } as unknown as IHashingPort,
        );
        const result = await handler.execute(
            new InitiateAdminActivationCommand('invitation', 'password', { sizeBytes: 4, contentType: 'image/png' }),
        );
        expect(result).toEqual({ mode: 'single', request, uploadToken: 'proof' });
        expect(initiateUpload).toHaveBeenCalledExactlyOnceWith({
            key: buildAdminPendingAvatarKey(admin.id, admin.inviteId!),
            sizeBytes: 4,
            contentType: 'image/png',
            cache: { visibility: 'no-store' },
            deadline: new Date((now + Math.min(300, remaining)) * 1000),
        });
        expect(generateUploadToken).toHaveBeenCalledWith(
            expect.objectContaining({
                formHash: 'form-digest',
                purpose: AdminUploadPurpose.ACTIVATION,
                exp: now + Math.min(600, remaining),
                sub: admin.id,
                fileKey: buildAdminPendingAvatarKey(admin.id, admin.inviteId!),
            }),
        );
        expect(hmacSha256).toHaveBeenCalledExactlyOnceWith(
            AdminUploadPurpose.ACTIVATION,
            canonicalizeAdminActivationForm({
                id: admin.id,
                inviteId: admin.inviteId!,
                password: 'password',
                avatar: { sizeBytes: 4, contentType: 'image/png' },
            }),
        );
        expect(admin.toSnapshot()).toEqual(before);
        expect(admin.pullJobs()).toEqual([]);
        expect(save).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    it('rejects revoked invitations before signing an upload', async () => {
        const admin = Admin.create({ id: 'admin', email: 'admin@example.test', name: 'Admin' });
        const initiateUpload = vi.fn();
        const generateUploadToken = vi.fn();
        const handler = new InitiateAdminActivationCommandHandler(
            { load: vi.fn().mockResolvedValue(admin), save: vi.fn() },
            {
                verifyInviteToken: vi.fn().mockResolvedValue({
                    sub: admin.id,
                    jti: 'old-invitation',
                    exp: admin.inviteExpiresAt!.getTime() / 1000,
                    inviteRevocationVersion: admin.inviteRevocationVersion,
                }),
                generateUploadToken,
            } as unknown as ITokenPort,
            { initiateUpload } as unknown as IStoragePort,
            { record: vi.fn() },
            { hmacSha256: vi.fn() } as unknown as IHashingPort,
        );
        await expect(
            handler.execute(
                new InitiateAdminActivationCommand('invitation', 'password', {
                    sizeBytes: 4,
                    contentType: 'image/png',
                }),
            ),
        ).rejects.toMatchObject({ kind: ExceptionKind.INVALID_INPUT });
        expect(initiateUpload).not.toHaveBeenCalled();
        expect(generateUploadToken).not.toHaveBeenCalled();
        expect(admin.avatarKey).toBeNull();
    });
});
