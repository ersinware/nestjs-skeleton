/**
 * @file handler.spec.ts
 * @description Verifies terminal attachment loss and retryable storage failures during avatar cleanup.
 */

import { FinalizeUserAvatarCommand } from 'src/module/user/application/command/finalize-user-avatar/command';
import { FinalizeUserAvatarCommandHandler } from 'src/module/user/application/command/finalize-user-avatar/handler';
import { User } from 'src/module/user/domain/aggregate/user.aggregate';
import { buildUserPendingAvatarKey, buildUserPermanentAvatarKey } from 'src/module/user/domain/user-avatar-key.util';
import {
    DependencyUnavailableException,
    ExceptionKind,
    ResourceConflictException,
    ResourceNotFoundException,
} from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

describe('FinalizeUserAvatarCommandHandler', () => {
    it.each(['existing-copy', 'copy-conflict', 'source-deleted', 'write-failure'] as const)(
        'reconciles %s before deleting the source',
        async (scenario) => {
            const id = '019a3b7c-8d42-7e19-9a65-c3f821b6d047';
            const deliveryId = id;
            const sourceKey = buildUserPendingAvatarKey(id, id);
            const destinationKey = buildUserPermanentAvatarKey(id, deliveryId);
            const user = User.create({
                id,
                email: 'avatar@example.test',
                name: 'Avatar',
                password: 'hash',
                avatarKey: sourceKey,
            });
            user.pullJobs();
            const metadata = { sizeBytes: 4, contentType: 'image/png', etag: 'source-etag' };
            const storage = {
                headObject: vi.fn().mockResolvedValue(metadata),
                copyObject: vi.fn(),
                deleteObject: vi.fn(),
            };
            const writer = { load: vi.fn().mockResolvedValue(user), save: vi.fn() };
            const audit = { record: vi.fn() };
            const transaction = { run: vi.fn(async (work: () => Promise<void>) => work()) };
            if (scenario !== 'existing-copy') storage.headObject.mockRejectedValueOnce(new ResourceNotFoundException());
            if (scenario === 'source-deleted')
                storage.headObject.mockRejectedValueOnce(new ResourceNotFoundException());
            if (scenario === 'copy-conflict') storage.copyObject.mockRejectedValueOnce(new ResourceConflictException());
            if (scenario === 'write-failure') writer.save.mockRejectedValueOnce(new DependencyUnavailableException());
            const handler = new FinalizeUserAvatarCommandHandler(
                writer as never,
                storage as never,
                transaction as never,
                audit,
            );
            const result = handler.execute(new FinalizeUserAvatarCommand(id, deliveryId));
            if (scenario === 'source-deleted') {
                await expect(result).rejects.toMatchObject({ kind: ExceptionKind.RESOURCE_NOT_FOUND });
                expect(storage.deleteObject).not.toHaveBeenCalled();
                expect(writer.save).not.toHaveBeenCalled();
                await handler.execute(new FinalizeUserAvatarCommand(id, deliveryId));
                expect(user.avatarKey).toBe(destinationKey);
                expect(storage.copyObject).not.toHaveBeenCalled();
                expect(storage.deleteObject).toHaveBeenCalledExactlyOnceWith(sourceKey);
                return;
            }
            if (scenario === 'write-failure') {
                await expect(result).rejects.toMatchObject({ kind: ExceptionKind.DEPENDENCY_UNAVAILABLE });
                expect(storage.deleteObject).not.toHaveBeenCalled();
                expect(audit.record).not.toHaveBeenCalled();
                return;
            }
            await result;
            expect(user.avatarKey).toBe(destinationKey);
            expect(writer.save).toHaveBeenCalledTimes(1);
            expect(audit.record).toHaveBeenCalledTimes(1);
            expect(storage.deleteObject).toHaveBeenCalledExactlyOnceWith(sourceKey);
            if (scenario === 'existing-copy') expect(storage.copyObject).not.toHaveBeenCalled();
        },
    );

    it.each([new ResourceNotFoundException(), new DependencyUnavailableException()])(
        'preserves failure disposition for an attached avatar: %s',
        async (error) => {
            const id = '019a3b7c-8d42-7e19-9a65-c3f821b6d047';
            const deliveryId = id;
            const sourceKey = buildUserPendingAvatarKey(id, id);
            const finalKey = buildUserPermanentAvatarKey(id, deliveryId);
            const user = User.create({
                id,
                email: 'avatar@example.test',
                name: 'Avatar',
                password: 'hash',
                avatarKey: sourceKey,
            });
            user.finalizeAvatar(sourceKey, finalKey, deliveryId);
            user.pullJobs();
            const writer = { load: vi.fn().mockResolvedValue(user), save: vi.fn() };
            const storage = {
                headObject: vi.fn().mockRejectedValue(error),
                deleteObject: vi.fn(),
                copyObject: vi.fn(),
            };
            const transaction = { run: vi.fn() };
            const audit = { record: vi.fn() };
            const handler = new FinalizeUserAvatarCommandHandler(
                writer as never,
                storage as never,
                transaction as never,
                audit,
            );
            const result = handler.execute(new FinalizeUserAvatarCommand(id, deliveryId));

            if (error.kind === ExceptionKind.RESOURCE_NOT_FOUND) {
                await expect(result).rejects.toMatchObject({
                    kind: ExceptionKind.TERMINAL_JOB,
                });
            } else {
                await expect(result).rejects.toBe(error);
            }
            expect(storage.headObject).toHaveBeenCalledExactlyOnceWith(finalKey);
            expect(storage.deleteObject).not.toHaveBeenCalled();
            expect(storage.copyObject).not.toHaveBeenCalled();
            expect(transaction.run).not.toHaveBeenCalled();
            expect(writer.save).not.toHaveBeenCalled();
            expect(audit.record).not.toHaveBeenCalled();
        },
    );
});
