/**
 * @file handler.spec.ts
 * @description Exercises replacement retries, selected-avatar retention, and cleanup after committed writes.
 */

import type { ITransactionPort } from 'src/core/database';

import { ReplaceAdminAvatarCommand } from 'src/module/admin/application/command/replace-admin-avatar/command';
import { ReplaceAdminAvatarCommandHandler } from 'src/module/admin/application/command/replace-admin-avatar/handler';
import {
    buildAdminPendingAvatarKey,
    buildAdminPermanentAvatarKey,
} from 'src/module/admin/domain/admin-avatar-key.util';
import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import { AdminAuditAction } from 'src/module/admin/shared/admin-audit';
import { AVATAR_PERMANENT_CACHE_POLICY } from 'src/shared/domain/avatar';
import {
    DependencyUnavailableException,
    ExceptionKind,
    ResourceConflictException,
    ResourceNotFoundException,
} from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

describe('ReplaceAdminAvatarCommandHandler', () => {
    const id = '019a3b7c-8d42-7e19-9a65-c3f821b6d047';
    const deliveryId = 'b603fdc2-5c63-4912-b40e-f0bf3b96f156';
    const previousId = 'c116ffde-c006-4b3f-902c-e658d6ad4142';
    const source = buildAdminPendingAvatarKey(id, deliveryId);
    const destination = buildAdminPermanentAvatarKey(id, deliveryId);
    const previousPending = buildAdminPendingAvatarKey(id, previousId);
    const previousPermanent = buildAdminPermanentAvatarKey(id, previousId);
    const metadata = { sizeBytes: 4, contentType: 'image/png', etag: 'etag' };

    /**
     * Supplies isolated storage and persistence boundaries for a selected avatar.
     *
     * @param key Current selection, or null for an inconsistent active account
     * @returns Handler and observed boundaries
     */
    function fixture(key: string | null = source) {
        const admin = Admin.reconstitute({
            ...Admin.create({ id, name: 'Admin', email: 'admin@example.test' }).toSnapshot(),
            password: 'hash',
            inviteId: null,
            inviteExpiresAt: null,
            inviteRevocationVersion: null,
            avatarKey: key,
        });
        const writer = { load: vi.fn().mockResolvedValue(admin), save: vi.fn() };
        const storage = { headObject: vi.fn().mockResolvedValue(metadata), copyObject: vi.fn(), deleteObject: vi.fn() };
        const audit = { record: vi.fn() };
        const transaction: ITransactionPort = { start: (work) => work(), join: vi.fn() };
        const handler = new ReplaceAdminAvatarCommandHandler(writer, storage as never, transaction, audit);
        return {
            admin,
            writer,
            storage,
            audit,
            handler,
            command: new ReplaceAdminAvatarCommand(id, deliveryId, previousId),
        };
    }

    it.each(['copy', 'existing-copy', 'copy-conflict', 'copy-not-found'] as const)(
        'commits %s before obsolete cleanup',
        async (scenario) => {
            const f = fixture();
            if (scenario !== 'existing-copy') {
                f.storage.headObject.mockRejectedValueOnce(new ResourceNotFoundException());
            }
            if (scenario === 'copy-conflict' || scenario === 'copy-not-found') {
                f.storage.copyObject.mockRejectedValueOnce(
                    scenario === 'copy-conflict' ? new ResourceConflictException() : new ResourceNotFoundException(),
                );
            }
            await f.handler.execute(f.command);
            expect(f.admin.avatarKey).toBe(destination);
            expect(f.writer.save).toHaveBeenCalledOnce();
            expect(f.audit.record).toHaveBeenCalledWith({
                action: AdminAuditAction.ADMIN_AVATAR_FINALIZED,
                targetId: id,
                detail: { deliveryId },
            });
            expect(f.storage.deleteObject.mock.calls.flat().sort()).toEqual(
                [source, previousPending, previousPermanent].sort(),
            );
            expect(f.writer.save.mock.invocationCallOrder[0]).toBeLessThan(
                f.storage.deleteObject.mock.invocationCallOrder[0]!,
            );
            expect(f.audit.record.mock.invocationCallOrder[0]).toBeLessThan(
                f.storage.deleteObject.mock.invocationCallOrder[0]!,
            );
            if (scenario === 'existing-copy') {
                expect(f.storage.copyObject).not.toHaveBeenCalled();
            } else {
                expect(f.storage.copyObject).toHaveBeenCalledWith({
                    sourceKey: source,
                    destinationKey: destination,
                    sourceEtag: metadata.etag,
                    contentType: metadata.contentType,
                    cache: AVATAR_PERMANENT_CACHE_POLICY,
                });
            }
        },
    );

    it.each(['save', 'audit', 'copy', 'head', 'source-missing', 'unreconciled-copy'] as const)(
        'preserves objects on %s failure',
        async (scenario) => {
            const f = fixture();
            const error = scenario === 'save' ? new ResourceConflictException() : new DependencyUnavailableException();
            if (scenario === 'save') f.writer.save.mockRejectedValueOnce(error);
            if (scenario === 'audit') f.audit.record.mockRejectedValueOnce(error);
            if (scenario === 'head') f.storage.headObject.mockRejectedValueOnce(error);
            if (scenario === 'copy' || scenario === 'source-missing' || scenario === 'unreconciled-copy') {
                f.storage.headObject.mockRejectedValueOnce(new ResourceNotFoundException());
            }
            if (scenario === 'source-missing')
                f.storage.headObject.mockRejectedValueOnce(new ResourceNotFoundException());
            if (scenario === 'copy') f.storage.copyObject.mockRejectedValueOnce(error);
            if (scenario === 'unreconciled-copy') {
                f.storage.copyObject.mockRejectedValueOnce(new ResourceConflictException());
                f.storage.headObject
                    .mockResolvedValueOnce(metadata)
                    .mockRejectedValueOnce(new ResourceNotFoundException());
            }
            await expect(f.handler.execute(f.command)).rejects.toMatchObject({
                kind:
                    scenario === 'source-missing'
                        ? ExceptionKind.RESOURCE_NOT_FOUND
                        : scenario === 'unreconciled-copy'
                          ? ExceptionKind.RESOURCE_CONFLICT
                          : error.kind,
            });
            expect(f.storage.deleteObject).not.toHaveBeenCalled();
        },
    );

    it.each(['other', 'previous-pending', 'previous-permanent'] as const)(
        'preserves the selected %s avatar on superseded delivery',
        async (scenario) => {
            const key =
                scenario === 'previous-pending'
                    ? previousPending
                    : scenario === 'previous-permanent'
                      ? previousPermanent
                      : buildAdminPendingAvatarKey(id, 'newer');
            const f = fixture(key);
            await f.handler.execute(f.command);
            const deleted = f.storage.deleteObject.mock.calls.flat();
            expect(deleted).toContain(source);
            expect(deleted).toContain(destination);
            expect(deleted).not.toContain(key);
            if (scenario === 'previous-pending') expect(deleted).not.toContain(previousPermanent);
            else expect(deleted).toContain(previousPending);
            if (scenario === 'other') expect(deleted).toContain(previousPermanent);
            expect(f.storage.headObject).not.toHaveBeenCalled();
            expect(f.writer.save).not.toHaveBeenCalled();
            expect(f.audit.record).not.toHaveBeenCalled();
        },
    );

    it('resumes cleanup without a second copy or mutation after a committed attempt', async () => {
        const f = fixture();
        const error = new DependencyUnavailableException();
        f.storage.deleteObject.mockRejectedValueOnce(error);
        await expect(f.handler.execute(f.command)).rejects.toBe(error);
        f.writer.load.mockResolvedValue(Admin.reconstitute(f.admin.toSnapshot()));
        await f.handler.execute(f.command);
        expect(f.writer.save).toHaveBeenCalledOnce();
        expect(f.audit.record).toHaveBeenCalledOnce();
        expect(f.storage.copyObject).not.toHaveBeenCalled();
        expect(f.storage.deleteObject).toHaveBeenCalledTimes(6);
    });

    it('terminates a missing attached destination without recopying its recreated source', async () => {
        const f = fixture(destination);
        f.storage.headObject.mockRejectedValueOnce(new ResourceNotFoundException());
        await expect(f.handler.execute(f.command)).rejects.toMatchObject({ kind: ExceptionKind.TERMINAL_JOB });
        expect(f.storage.headObject).toHaveBeenCalledExactlyOnceWith(destination);
        expect(f.storage.copyObject).not.toHaveBeenCalled();
        expect(f.storage.deleteObject).not.toHaveBeenCalled();
    });

    it('retains all objects when the writer excludes a deleted account', async () => {
        const f = fixture();
        f.writer.load.mockResolvedValue(null);
        await f.handler.execute(f.command);
        expect(f.storage.headObject).not.toHaveBeenCalled();
        expect(f.storage.deleteObject).not.toHaveBeenCalled();
        expect(f.writer.save).not.toHaveBeenCalled();
    });

    it('terminates an active account without an avatar before storage access', async () => {
        const f = fixture(null);
        await expect(f.handler.execute(f.command)).rejects.toMatchObject({ kind: ExceptionKind.TERMINAL_JOB });
        expect(f.storage.deleteObject).not.toHaveBeenCalled();
        expect(f.storage.headObject).not.toHaveBeenCalled();
    });
});
