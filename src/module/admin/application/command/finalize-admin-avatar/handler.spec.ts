/**
 * @file handler.spec.ts
 * @description Verifies terminal attachment loss and retryable storage failures during avatar cleanup.
 */

import type { ITransactionPort } from 'src/core/database';
import { FinalizeAdminAvatarCommand } from 'src/module/admin/application/command/finalize-admin-avatar/command';
import { FinalizeAdminAvatarCommandHandler } from 'src/module/admin/application/command/finalize-admin-avatar/handler';
import {
    buildAdminPendingAvatarKey,
    buildAdminPermanentAvatarKey,
} from 'src/module/admin/domain/admin-avatar-key.util';
import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import {
    DependencyUnavailableException,
    ExceptionKind,
    ResourceConflictException,
    ResourceNotFoundException,
} from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

describe('FinalizeAdminAvatarCommandHandler', () => {
    it.each(['existing-copy', 'copy-conflict', 'source-deleted', 'write-failure'] as const)(
        'reconciles %s before deleting the source',
        async (scenario) => {
            const id = '019a3b7c-8d42-7e19-9a65-c3f821b6d047';
            const deliveryId = 'b603fdc2-5c63-4912-b40e-f0bf3b96f156';
            const sourceKey = buildAdminPendingAvatarKey(id, deliveryId);
            const destinationKey = buildAdminPermanentAvatarKey(id, deliveryId);
            const pending = Admin.create({
                id,
                email: 'avatar@example.test',
                name: 'Avatar',
            });
            const admin = Admin.reconstitute({ ...pending.toSnapshot(), password: 'hash', avatarKey: sourceKey });
            admin.pullJobs();
            const metadata = { sizeBytes: 4, contentType: 'image/png', etag: 'source-etag' };
            const storage = {
                headObject: vi.fn().mockResolvedValue(metadata),
                copyObject: vi.fn(),
                deleteObject: vi.fn(),
            };
            const writer = { load: vi.fn().mockResolvedValue(admin), save: vi.fn() };
            const audit = { record: vi.fn() };
            const transaction: ITransactionPort = { run: (work) => work() };
            if (scenario !== 'existing-copy') {
                storage.headObject.mockRejectedValueOnce(new ResourceNotFoundException());
            }
            if (scenario === 'source-deleted') {
                storage.headObject.mockRejectedValueOnce(new ResourceNotFoundException());
            }
            if (scenario === 'copy-conflict') {
                storage.copyObject.mockRejectedValueOnce(new ResourceConflictException());
            }
            if (scenario === 'write-failure') {
                writer.save.mockRejectedValueOnce(new DependencyUnavailableException());
            }
            const handler = new FinalizeAdminAvatarCommandHandler(writer, storage as never, transaction, audit);
            const result = handler.execute(new FinalizeAdminAvatarCommand(id, deliveryId));
            if (scenario === 'source-deleted') {
                await expect(result).rejects.toMatchObject({ kind: ExceptionKind.RESOURCE_NOT_FOUND });
                expect(storage.deleteObject).not.toHaveBeenCalled();
                expect(writer.save).not.toHaveBeenCalled();
                await handler.execute(new FinalizeAdminAvatarCommand(id, deliveryId));
                expect(admin.avatarKey).toBe(destinationKey);
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
            expect(admin.avatarKey).toBe(destinationKey);
            expect(writer.save).toHaveBeenCalledTimes(1);
            expect(audit.record).toHaveBeenCalledTimes(1);
            expect(storage.deleteObject).toHaveBeenCalledExactlyOnceWith(sourceKey);
            if (scenario === 'existing-copy') {
                expect(storage.copyObject).not.toHaveBeenCalled();
            }
        },
    );

    it.each([new ResourceNotFoundException(), new DependencyUnavailableException()])(
        'preserves failure disposition for an attached avatar: %s',
        async (error) => {
            const id = '019a3b7c-8d42-7e19-9a65-c3f821b6d047';
            const deliveryId = 'b603fdc2-5c63-4912-b40e-f0bf3b96f156';
            const sourceKey = buildAdminPendingAvatarKey(id, deliveryId);
            const finalKey = buildAdminPermanentAvatarKey(id, deliveryId);
            const pending = Admin.create({
                id,
                email: 'avatar@example.test',
                name: 'Avatar',
            });
            const admin = Admin.reconstitute({ ...pending.toSnapshot(), password: 'hash', avatarKey: sourceKey });
            admin.finalizeAvatar(sourceKey, finalKey, deliveryId);
            admin.pullJobs();
            const writer = { load: vi.fn().mockResolvedValue(admin), save: vi.fn() };
            const storage = {
                headObject: vi.fn().mockRejectedValue(error),
                deleteObject: vi.fn(),
                copyObject: vi.fn(),
            };
            const transaction = { run: vi.fn() };
            const audit = { record: vi.fn() };
            const handler = new FinalizeAdminAvatarCommandHandler(writer, storage as never, transaction, audit);
            const result = handler.execute(new FinalizeAdminAvatarCommand(id, deliveryId));

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
    it('reports an invalid attached key before touching storage', async () => {
        const admin = Admin.create({ id: 'admin', name: 'Admin', email: 'admin@example.test' });
        const writer = { load: vi.fn().mockResolvedValue(admin), save: vi.fn() };
        const storage = { headObject: vi.fn(), copyObject: vi.fn(), deleteObject: vi.fn() };
        const handler = new FinalizeAdminAvatarCommandHandler(
            writer,
            storage as never,
            { run: vi.fn() },
            { record: vi.fn() },
        );
        await expect(
            handler.execute(new FinalizeAdminAvatarCommand(admin.id, 'obsolete-invite')),
        ).rejects.toMatchObject({
            kind: ExceptionKind.TERMINAL_JOB,
        });
        expect(storage.headObject).not.toHaveBeenCalled();
        expect(storage.copyObject).not.toHaveBeenCalled();
        expect(storage.deleteObject).not.toHaveBeenCalled();
        expect(writer.save).not.toHaveBeenCalled();
    });
    it.each(['pending', 'permanent'] as const)(
        'leaves superseded cleanup to replacement while preserving the newer %s avatar',
        async (kind) => {
            const id = '019a3b7c-8d42-7e19-9a65-c3f821b6d047';
            const deliveryId = 'b603fdc2-5c63-4912-b40e-f0bf3b96f156';
            const newerId = 'c116ffde-c006-4b3f-902c-e658d6ad4142';
            const selectedKey =
                kind === 'pending'
                    ? buildAdminPendingAvatarKey(id, newerId)
                    : buildAdminPermanentAvatarKey(id, newerId);
            const admin = Admin.reconstitute({
                ...Admin.create({ id, name: 'Admin', email: 'admin@example.test' }).toSnapshot(),
                password: 'hash',
                inviteId: null,
                inviteExpiresAt: null,
                inviteRevocationVersion: null,
                avatarKey: selectedKey,
            });
            const before = admin.toSnapshot();
            const writer = { load: vi.fn().mockResolvedValue(admin), save: vi.fn() };
            const storage = { headObject: vi.fn(), copyObject: vi.fn(), deleteObject: vi.fn() };
            const audit = { record: vi.fn() };
            const handler = new FinalizeAdminAvatarCommandHandler(
                writer,
                storage as never,
                { run: (work) => work() },
                audit,
            );
            await handler.execute(new FinalizeAdminAvatarCommand(id, deliveryId));
            expect(admin.toSnapshot()).toEqual(before);
            expect(storage.deleteObject).not.toHaveBeenCalled();
            expect(storage.headObject).not.toHaveBeenCalled();
            expect(storage.copyObject).not.toHaveBeenCalled();
            expect(writer.save).not.toHaveBeenCalled();
            expect(audit.record).not.toHaveBeenCalled();
        },
    );

    it('retries cleanup after another avatar supersedes a committed delivery', async () => {
        const id = '019a3b7c-8d42-7e19-9a65-c3f821b6d047';
        const deliveryId = 'b603fdc2-5c63-4912-b40e-f0bf3b96f156';
        const finalKey = buildAdminPermanentAvatarKey(id, deliveryId);
        const admin = Admin.reconstitute({
            ...Admin.create({ id, name: 'Admin', email: 'admin@example.test' }).toSnapshot(),
            password: 'hash',
            inviteId: null,
            inviteExpiresAt: null,
            inviteRevocationVersion: null,
            avatarKey: finalKey,
        });
        const writer = {
            load: vi.fn().mockImplementation(() => Promise.resolve(Admin.reconstitute(admin.toSnapshot()))),
            save: vi.fn(),
        };
        const failure = new DependencyUnavailableException();
        const storage = {
            headObject: vi.fn().mockResolvedValue({ sizeBytes: 4 }),
            copyObject: vi.fn(),
            deleteObject: vi.fn().mockRejectedValueOnce(failure),
        };
        const audit = { record: vi.fn() };
        const handler = new FinalizeAdminAvatarCommandHandler(
            writer,
            storage as never,
            { run: (work) => work() },
            audit,
        );
        const command = new FinalizeAdminAvatarCommand(id, deliveryId);
        await expect(handler.execute(command)).rejects.toBe(failure);
        const newerId = 'c116ffde-c006-4b3f-902c-e658d6ad4142';
        const selectedKey = buildAdminPendingAvatarKey(id, newerId);
        admin.update(undefined, {
            fileKey: selectedKey,
            jti: newerId,
            revocationVersion: admin.revocationVersion,
        });
        await handler.execute(command);
        expect(admin.avatarKey).toBe(selectedKey);
        expect(storage.deleteObject.mock.calls).toEqual([[buildAdminPendingAvatarKey(id, deliveryId)]]);
        expect(storage.copyObject).not.toHaveBeenCalled();
        expect(writer.save).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
    });
});
