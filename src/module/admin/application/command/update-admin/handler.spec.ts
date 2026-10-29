/**
 * @file handler.spec.ts
 * @description Verifies independent profile mutations and rejection before persistence or avatar delivery.
 */

import { ConfigService } from '@nestjs/config';
import { ENV } from 'src/core/config';
import type { ITransactionPort } from 'src/core/database';

import type { ITokenPort } from 'src/core/security/token';
import type { IStoragePort } from 'src/core/storage';
import { UpdateAdminCommand } from 'src/module/admin/application/command/update-admin/command';
import { UpdateAdminCommandHandler } from 'src/module/admin/application/command/update-admin/handler';
import { createAdminAvatarChangeFormHash } from 'src/module/admin/domain/admin-avatar-change';
import {
    buildAdminPendingAvatarKey,
    buildAdminPermanentAvatarKey,
} from 'src/module/admin/domain/admin-avatar-key.util';
import { AdminUploadPurpose } from 'src/module/admin/domain/admin-upload-purpose.enum';
import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import { AdminJobQueue } from 'src/module/admin/domain/job/admin-job-queue.enum';
import { AdminAuditAction } from 'src/module/admin/shared/admin-audit';
import {
    DependencyUnavailableException,
    ExceptionKind,
    ResourceNotFoundException,
    UnauthenticatedException,
} from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

describe('UpdateAdminCommandHandler', () => {
    it.each(['not-found', 'database-failure'] as const)(
        'stops before token or storage access on %s',
        async (scenario) => {
            const failure = new DependencyUnavailableException();
            const writer = { load: vi.fn().mockResolvedValue(null), save: vi.fn() };
            if (scenario === 'database-failure') {
                writer.load.mockRejectedValueOnce(failure);
            }
            const audit = { record: vi.fn() };
            const token = { verifyUploadToken: vi.fn() };
            const storage = { headObject: vi.fn() };
            const transaction = { start: vi.fn(), join: vi.fn() };
            const handler = new UpdateAdminCommandHandler(
                transaction,
                writer,
                audit,
                token as unknown as ITokenPort,
                storage as unknown as IStoragePort,
                new ConfigService({ [ENV.JWT_UPLOAD_SECRET]: 'secret' }),
            );

            const result = handler.execute(new UpdateAdminCommand('owner', 'Changed'));
            if (scenario === 'database-failure') {
                await expect(result).rejects.toBe(failure);
            } else {
                await expect(result).rejects.toMatchObject({ kind: ExceptionKind.RESOURCE_NOT_FOUND });
            }
            expect(token.verifyUploadToken).not.toHaveBeenCalled();
            expect(storage.headObject).not.toHaveBeenCalled();
            expect(writer.save).not.toHaveBeenCalled();
            expect(transaction.start).not.toHaveBeenCalled();
            expect(audit.record).not.toHaveBeenCalled();
        },
    );

    it.each(['empty', 'avatar-without-proof', 'proof-without-avatar'] as const)(
        'rejects %s before loading or calling dependencies',
        async (scenario) => {
            const writer = { load: vi.fn(), save: vi.fn() };
            const audit = { record: vi.fn() };
            const token = { verifyUploadToken: vi.fn() };
            const storage = { headObject: vi.fn() };
            const handler = new UpdateAdminCommandHandler(
                { start: vi.fn(), join: vi.fn() },
                writer,
                audit,
                token as unknown as ITokenPort,
                storage as unknown as IStoragePort,
                new ConfigService({ [ENV.JWT_UPLOAD_SECRET]: 'secret' }),
            );
            const command = new UpdateAdminCommand(
                'owner',
                undefined,
                scenario === 'avatar-without-proof' ? { sizeBytes: 4, contentType: 'image/png' } : undefined,
                scenario === 'proof-without-avatar' ? 'proof' : undefined,
            );
            await expect(handler.execute(command)).rejects.toMatchObject({ kind: ExceptionKind.INVALID_INPUT });
            expect(writer.load).not.toHaveBeenCalled();
            expect(token.verifyUploadToken).not.toHaveBeenCalled();
            expect(storage.headObject).not.toHaveBeenCalled();
            expect(audit.record).not.toHaveBeenCalled();
        },
    );

    it.each([
        'name-only',
        'unchanged-name',
        'avatar-only',
        'combined',
        'invalid-proof',
        'ownership',
        'binding',
        'revoked',
        'missing-object',
        'metadata',
        'replay',
        'invalid-key',
        'banned',
        'banned-audit-failure',
        'inactive',
        'missing-avatar',
    ] as const)('handles %s without forbidden effects', async (scenario) => {
        const id = '019a3b7c-8d42-7e19-9a65-c3f821b6d047';
        const avatarId = 'b603fdc2-5c63-4912-b40e-f0bf3b96f156';
        const currentKey = buildAdminPermanentAvatarKey(id, 'c116ffde-c006-4b3f-902c-e658d6ad4142');
        const sourceKey = buildAdminPendingAvatarKey(id, avatarId);
        const admin = Admin.reconstitute({
            ...Admin.create({ id, email: 'admin@example.test', name: 'Admin' }).toSnapshot(),
            password: scenario === 'inactive' ? null : 'hash',
            inviteId: null,
            inviteExpiresAt: null,
            inviteRevocationVersion: null,
            avatarKey: scenario === 'missing-avatar' ? null : scenario === 'replay' ? sourceKey : currentKey,
            isBanned: scenario === 'banned' || scenario === 'banned-audit-failure',
        });
        const before = admin.toSnapshot();
        const avatar = { sizeBytes: 4, contentType: 'image/png' } as const;
        const name =
            scenario === 'name-only' || scenario === 'combined'
                ? 'New Admin'
                : scenario === 'unchanged-name'
                  ? 'Admin'
                  : undefined;
        const payload = {
            sub: scenario === 'ownership' ? 'another-account' : id,
            jti: avatarId,
            revocationVersion: scenario === 'revoked' ? 1 : admin.revocationVersion,
            fileKey: scenario === 'invalid-key' ? 'foreign/key' : sourceKey,
            formHash: createAdminAvatarChangeFormHash(
                {
                    id,
                    avatarId,
                    ...(name !== undefined && { name }),
                    avatar,
                },
                'upload-secret',
            ),
        };
        if (scenario === 'binding') {
            payload.formHash = 'mismatched-binding';
        }
        const verifyUploadToken = vi.fn().mockResolvedValue(payload);
        if (scenario === 'invalid-proof') {
            verifyUploadToken.mockRejectedValue(new UnauthenticatedException());
        }
        const storage = {
            headObject: vi.fn().mockResolvedValue({ ...avatar, sizeBytes: scenario === 'metadata' ? 5 : 4 }),
        };
        if (scenario === 'missing-object') {
            storage.headObject.mockRejectedValue(new ResourceNotFoundException());
        }
        const writer = { load: vi.fn().mockResolvedValue(admin), save: vi.fn() };
        const audit = { record: vi.fn() };
        if (scenario === 'banned-audit-failure') {
            audit.record.mockRejectedValueOnce(new DependencyUnavailableException());
        }
        const transaction: ITransactionPort = { start: (work) => work(), join: vi.fn() };
        const start = vi.spyOn(transaction, 'start');
        const handler = new UpdateAdminCommandHandler(
            transaction,
            writer,
            audit,
            { verifyUploadToken } as unknown as ITokenPort,
            storage as unknown as IStoragePort,
            new ConfigService({ [ENV.JWT_UPLOAD_SECRET]: 'upload-secret' }),
        );
        const hasUpload = scenario !== 'name-only' && scenario !== 'unchanged-name';
        const result = handler.execute(
            hasUpload
                ? new UpdateAdminCommand(id, name, avatar, 'proof')
                : new UpdateAdminCommand(id, scenario === 'unchanged-name' ? 'Admin' : 'New Admin'),
        );
        const failureKind = {
            'invalid-proof': ExceptionKind.INVALID_INPUT,
            ownership: ExceptionKind.ACCESS_DENIED,
            binding: ExceptionKind.INVALID_INPUT,
            revoked: ExceptionKind.INVALID_INPUT,
            'missing-object': ExceptionKind.INVALID_INPUT,
            metadata: ExceptionKind.INVALID_INPUT,
            replay: ExceptionKind.RESOURCE_CONFLICT,
            'invalid-key': ExceptionKind.SYSTEM,
            banned: ExceptionKind.ACCESS_DENIED,
            'banned-audit-failure': ExceptionKind.DEPENDENCY_UNAVAILABLE,
            inactive: ExceptionKind.SYSTEM,
            'missing-avatar': ExceptionKind.SYSTEM,
        };
        if (scenario in failureKind) {
            await expect(result).rejects.toMatchObject({ kind: failureKind[scenario as keyof typeof failureKind] });
            expect(admin.toSnapshot()).toEqual(before);
            expect(admin.pullJobs()).toEqual([]);
            expect(writer.save).not.toHaveBeenCalled();
            if (scenario === 'ownership') {
                expect(audit.record).toHaveBeenCalledWith(
                    { action: 'ADMIN_UPDATE_FAILED', reason: 'PRINCIPAL_MISMATCH', targetId: payload.sub },
                    { markExceptionAsAudited: expect.anything() as unknown },
                );
            } else if (scenario === 'banned' || scenario === 'banned-audit-failure') {
                expect(audit.record).toHaveBeenCalledWith(
                    { action: AdminAuditAction.ADMIN_UPDATE_FAILED, reason: 'ACCOUNT_BANNED' },
                    { markExceptionAsAudited: expect.anything() as unknown },
                );
            } else {
                expect(audit.record).not.toHaveBeenCalled();
            }
            expect(start).not.toHaveBeenCalled();
            if (scenario !== 'missing-object' && scenario !== 'metadata') {
                expect(storage.headObject).not.toHaveBeenCalled();
            }
            return;
        }
        await result;
        expect(admin.name).toBe(name ?? before.name);
        expect(admin.avatarKey).toBe(hasUpload ? sourceKey : currentKey);
        expect(admin.sessionVersion).toBe(before.sessionVersion);
        expect(admin.revocationVersion).toBe(before.revocationVersion);
        expect(writer.save).toHaveBeenCalledTimes(scenario === 'unchanged-name' ? 0 : 1);
        if (hasUpload) {
            expect(verifyUploadToken).toHaveBeenCalledWith('proof', AdminUploadPurpose.PROFILE_AVATAR, true);
            expect(admin.pullJobs()).toEqual([
                {
                    deliveryId: avatarId,
                    aggregateId: id,
                    queueName: AdminJobQueue.AVATAR_REPLACE,
                    payload: { previousAvatarId: 'c116ffde-c006-4b3f-902c-e658d6ad4142' },
                },
            ]);
        } else {
            expect(admin.pullJobs()).toEqual([]);
            expect(verifyUploadToken).not.toHaveBeenCalled();
            expect(storage.headObject).not.toHaveBeenCalled();
        }
        expect(audit.record).toHaveBeenCalledTimes(scenario === 'unchanged-name' ? 0 : 1);
        if (scenario !== 'unchanged-name') {
            expect(audit.record).toHaveBeenCalledWith({ action: AdminAuditAction.ADMIN_UPDATED });
        }
    });
});
