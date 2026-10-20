/**
 * @file handler.spec.ts
 * @description Verifies independent profile mutations and rejection before persistence or avatar delivery.
 */

import { ConfigService } from '@nestjs/config';
import { ENV } from 'src/core/config';
import type { ITransactionPort } from 'src/core/database';

import type { ITokenPort } from 'src/core/security/token';
import type { IStoragePort } from 'src/core/storage';
import { UpdateUserCommand } from 'src/module/user/application/command/update-user/command';
import { UpdateUserCommandHandler } from 'src/module/user/application/command/update-user/handler';
import { User } from 'src/module/user/domain/aggregate/user.aggregate';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';
import { createUserAvatarChangeFormHash } from 'src/module/user/domain/user-avatar-change';
import { buildUserPendingAvatarKey, buildUserPermanentAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import { UserUploadPurpose } from 'src/module/user/domain/user-upload-purpose.enum';
import { UserAuditAction } from 'src/module/user/shared/user-audit';
import { ExceptionKind, ResourceNotFoundException, UnauthenticatedException } from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

describe('UpdateUserCommandHandler', () => {
    it.each(['empty', 'avatar-without-proof', 'proof-without-avatar'] as const)(
        'rejects %s before loading or calling dependencies',
        async (scenario) => {
            const writer = { load: vi.fn(), save: vi.fn(), loadByEmail: vi.fn(), insert: vi.fn() };
            const audit = { record: vi.fn() };
            const token = { verifyUploadToken: vi.fn() };
            const storage = { headObject: vi.fn() };
            const handler = new UpdateUserCommandHandler(
                { run: vi.fn() },
                writer,
                audit,
                token as unknown as ITokenPort,
                storage as unknown as IStoragePort,
                new ConfigService({ [ENV.JWT_UPLOAD_SECRET]: 'secret' }),
            );
            const command = new UpdateUserCommand(
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
    ] as const)('handles %s without forbidden effects', async (scenario) => {
        const id = '019a3b7c-8d42-7e19-9a65-c3f821b6d047';
        const avatarId = 'b603fdc2-5c63-4912-b40e-f0bf3b96f156';
        const currentKey = buildUserPermanentAvatarKey(id, 'c116ffde-c006-4b3f-902c-e658d6ad4142');
        const sourceKey = buildUserPendingAvatarKey(id, avatarId);
        const user = User.reconstitute({
            ...User.create({
                id,
                email: 'user@example.test',
                name: 'User',
                password: 'hash',
                avatarKey: buildUserPendingAvatarKey(id, id),
            }).toSnapshot(),
            activationId: null,
            activationExpiresAt: null,
            activationRevocationVersion: null,
            avatarKey: scenario === 'replay' ? sourceKey : currentKey,
        });
        const before = user.toSnapshot();
        const avatar = { sizeBytes: 4, contentType: 'image/png' } as const;
        const name =
            scenario === 'name-only' || scenario === 'combined'
                ? 'New User'
                : scenario === 'unchanged-name'
                  ? 'User'
                  : undefined;
        const payload = {
            sub: scenario === 'ownership' ? 'another-account' : id,
            jti: avatarId,
            revocationVersion: scenario === 'revoked' ? 1 : user.revocationVersion,
            fileKey: scenario === 'invalid-key' ? 'foreign/key' : sourceKey,
            formHash: createUserAvatarChangeFormHash(
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
        const writer = { load: vi.fn().mockResolvedValue(user), save: vi.fn(), loadByEmail: vi.fn(), insert: vi.fn() };
        const audit = { record: vi.fn() };
        const transaction: ITransactionPort = { run: (work) => work() };
        const run = vi.spyOn(transaction, 'run');
        const handler = new UpdateUserCommandHandler(
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
                ? new UpdateUserCommand(id, name, avatar, 'proof')
                : new UpdateUserCommand(id, scenario === 'unchanged-name' ? 'User' : 'New User'),
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
        };
        if (scenario in failureKind) {
            await expect(result).rejects.toMatchObject({ kind: failureKind[scenario as keyof typeof failureKind] });
            expect(user.toSnapshot()).toEqual(before);
            expect(user.pullJobs()).toEqual([]);
            expect(writer.save).not.toHaveBeenCalled();
            if (scenario === 'ownership') {
                expect(audit.record).toHaveBeenCalledWith(
                    { action: 'USER_UPDATE_FAILED', reason: 'PRINCIPAL_MISMATCH', targetId: payload.sub },
                    { markExceptionAsAudited: expect.anything() as unknown },
                );
            } else {
                expect(audit.record).not.toHaveBeenCalled();
            }
            expect(run).not.toHaveBeenCalled();
            if (scenario !== 'missing-object' && scenario !== 'metadata' && scenario !== 'revoked') {
                expect(storage.headObject).not.toHaveBeenCalled();
            }
            return;
        }
        await result;
        expect(user.name).toBe(name ?? before.name);
        expect(user.avatarKey).toBe(hasUpload ? sourceKey : currentKey);
        expect(user.sessionVersion).toBe(before.sessionVersion);
        expect(user.revocationVersion).toBe(before.revocationVersion);
        expect(writer.save).toHaveBeenCalledTimes(scenario === 'unchanged-name' ? 0 : 1);
        if (hasUpload) {
            expect(verifyUploadToken).toHaveBeenCalledWith('proof', UserUploadPurpose.PROFILE_AVATAR, true);
            expect(user.pullJobs()).toEqual([
                {
                    deliveryId: avatarId,
                    aggregateId: id,
                    queueName: UserJobQueue.AVATAR_REPLACE,
                    payload: { previousAvatarId: 'c116ffde-c006-4b3f-902c-e658d6ad4142' },
                },
                {
                    deliveryId: expect.any(String) as string,
                    aggregateId: id,
                    queueName: UserJobQueue.CACHE_INVALIDATE,
                },
            ]);
        } else {
            expect(user.pullJobs()).toHaveLength(scenario === 'unchanged-name' ? 0 : 1);
            expect(verifyUploadToken).not.toHaveBeenCalled();
            expect(storage.headObject).not.toHaveBeenCalled();
        }
        expect(audit.record).toHaveBeenCalledTimes(scenario === 'unchanged-name' ? 0 : 1);
        if (scenario !== 'unchanged-name') {
            expect(audit.record).toHaveBeenCalledWith({ action: UserAuditAction.USER_UPDATED });
        }
    });
});
