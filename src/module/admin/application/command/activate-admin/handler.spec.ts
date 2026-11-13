/**
 * @file handler.spec.ts
 * @description Activation preserves business refusal kinds and evidence while preventing rejected writes.
 */

import { randomUUID } from 'node:crypto';
import type { IIdempotencyPort } from 'src/core/idempotency';
import type { IAuditPort } from 'src/core/observability/audit';
import type { IHashingPort } from 'src/core/security/hashing';
import type { ITokenPort } from 'src/core/security/token';
import type { IStoragePort, UploadTokenPayload } from 'src/core/storage';
import { ADMIN_INVITE_TOKEN_TYPE, type InviteTokenPayload } from 'src/module/admin/application/admin-invite-token';
import { AdminUploadTokenType } from 'src/module/admin/application/admin-upload-token';
import { ActivateAdminCommand } from 'src/module/admin/application/command/activate-admin/command';
import { ActivateAdminCommandHandler } from 'src/module/admin/application/command/activate-admin/handler';
import type { IAdminWriterPort } from 'src/module/admin/application/command/port/admin-writer.port';
import { canonicalizeAdminActivationForm } from 'src/module/admin/domain/admin-activation';
import { buildAdminPendingAvatarKey } from 'src/module/admin/domain/admin-avatar-key.util';
import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import { AdminAuditAction } from 'src/module/admin/shared/admin-audit';
import {
    AccessDeniedException,
    InvalidInputException,
    ResourceConflictException,
    ResourceNotFoundException,
    SystemException,
} from 'src/shared/exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('ActivateAdminCommandHandler', () => {
    const load = vi.fn<IAdminWriterPort['load']>(),
        save = vi.fn<IAdminWriterPort['save']>(),
        record = vi.fn<IAuditPort['record']>(),
        verifyInviteToken =
            vi.fn<(token: string, expectedType: typeof ADMIN_INVITE_TOKEN_TYPE) => Promise<InviteTokenPayload>>(),
        verifyUploadToken =
            vi.fn<
                (token: string, expectedType: AdminUploadTokenType) => Promise<UploadTokenPayload<AdminUploadTokenType>>
            >(),
        hash = vi.fn<IHashingPort['hashPassword']>(),
        verifyHmacSha256 = vi.fn<IHashingPort['verifyHmacSha256']>(),
        idempotency: IIdempotencyPort = {
            execute: (_request, work) => work(),
            executePrepared: async (_request, prepare, work) => work(await prepare()),
        },
        command = new ActivateAdminCommand(
            { key: randomUUID(), canonicalValue: JSON.stringify(['POST', '/test/ActivateAdmin']) },
            'invitation',
            'new-password',
            { sizeBytes: 1024, contentType: 'image/png' },
            'upload-proof',
        );
    let admin: Admin, handler: ActivateAdminCommandHandler;

    beforeEach(() => {
        admin = Admin.create({ id: 'admin-1', email: 'admin@example.test', name: 'Admin' });
        load.mockResolvedValue(admin);
        save.mockResolvedValue(undefined);
        record.mockResolvedValue(undefined);
        hash.mockResolvedValue('hashed-password');
        verifyHmacSha256.mockReturnValue(true);
        verifyInviteToken.mockResolvedValue({
            sub: admin.id,
            jti: admin.inviteId!,
            exp: admin.inviteExpiresAt!.getTime() / 1000,
            inviteRevocationVersion: admin.inviteRevocationVersion!,
            type: ADMIN_INVITE_TOKEN_TYPE,
        });
        verifyUploadToken.mockImplementation(() =>
            Promise.resolve({
                sub: admin.id,
                jti: 'upload-id',
                fileKey: buildAdminPendingAvatarKey(admin.id, admin.inviteId!),
                exp: admin.inviteExpiresAt!.getTime() / 1000,
                formHash: 'form-digest',
                type: AdminUploadTokenType.ACTIVATION,
            }),
        );
        handler = new ActivateAdminCommandHandler(
            idempotency,
            { load, save },
            { verify: verifyInviteToken } as unknown as ITokenPort<typeof ADMIN_INVITE_TOKEN_TYPE>,
            { verify: verifyUploadToken } as unknown as ITokenPort<typeof AdminUploadTokenType.ACTIVATION>,
            { hashPassword: hash, verifyHmacSha256 } as unknown as IHashingPort,
            { record },
            {
                headObject: vi
                    .fn()
                    .mockResolvedValue({ sizeBytes: 1024, contentType: 'image/png', etag: 'source-etag' }),
            } as unknown as IStoragePort,
        );
    });

    it('returns not found without hashing, saving, or auditing a missing account', async () => {
        load.mockResolvedValueOnce(null);
        await expect(handler.execute(command)).rejects.toBeInstanceOf(ResourceNotFoundException);
        expect(record).not.toHaveBeenCalled();
        expect(hash).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
    });

    it.each([
        ['banned', AccessDeniedException, true],
        ['active', ResourceConflictException, false],
    ] as const)('preserves the %s refusal and audits only the ban', async (state, exceptionType, audited) => {
        admin = Admin.reconstitute({
            ...admin.toSnapshot(),
            isBanned: state === 'banned',
            password: state === 'active' ? 'existing-hash' : null,
        });
        load.mockResolvedValueOnce(admin);
        const failure = await handler.execute(command).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(exceptionType);
        if (audited) {
            expect(record).toHaveBeenCalledExactlyOnceWith(
                {
                    action: 'ADMIN_ACTIVATION_FAILED',
                    reason: 'ACCOUNT_BANNED',
                    targetId: admin.id,
                },
                { markExceptionAsAudited: failure },
            );
        } else {
            expect(record).not.toHaveBeenCalled();
        }
        expect(save).not.toHaveBeenCalled();
    });

    it('rethrows the exact aggregate error after audit acceptance', async () => {
        const failure = new AccessDeniedException('Banned', {
            audit: { action: AdminAuditAction.ADMIN_ACTIVATION_FAILED, reason: 'ACCOUNT_BANNED' },
        });
        vi.spyOn(admin, 'activate').mockImplementationOnce(() => {
            throw failure;
        });
        await expect(handler.execute(command)).rejects.toBe(failure);
        expect(record).toHaveBeenCalledExactlyOnceWith(
            { ...failure.audit, targetId: admin.id },
            { markExceptionAsAudited: failure },
        );
        expect(save).not.toHaveBeenCalled();
    });

    it('propagates audit failure and never saves the rejected mutation', async () => {
        const failure = new Error('Audit unavailable');
        load.mockResolvedValueOnce(Admin.reconstitute({ ...admin.toSnapshot(), isBanned: true }));
        record.mockRejectedValueOnce(failure);
        await expect(handler.execute(command)).rejects.toBe(failure);
        expect(save).not.toHaveBeenCalled();
    });

    it('preserves unmarked system faults without refusal audit', async () => {
        const failure = new SystemException('Broken aggregate contract');
        vi.spyOn(admin, 'activate').mockImplementationOnce(() => {
            throw failure;
        });
        await expect(handler.execute(command)).rejects.toBe(failure);
        expect(record).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
    });
    it('rechecks the invitation deadline after password hashing without saving expired activation', async () => {
        hash.mockImplementationOnce(() => {
            // Hashing can outlast the loaded invitation even though JWT verification already passed.
            vi.spyOn(Date, 'now').mockReturnValue(Number.MAX_SAFE_INTEGER);
            return Promise.resolve('hashed-password');
        });
        await expect(handler.execute(command)).rejects.toBeInstanceOf(InvalidInputException);
        expect(save).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });
    it('rejects a mismatched form before password hashing or persistence', async () => {
        verifyHmacSha256.mockReturnValueOnce(false);
        await expect(handler.execute(command)).rejects.toBeInstanceOf(InvalidInputException);
        expect(verifyHmacSha256).toHaveBeenCalledExactlyOnceWith(
            AdminUploadTokenType.ACTIVATION,
            canonicalizeAdminActivationForm({
                id: admin.id,
                inviteId: admin.inviteId!,
                password: command.password,
                avatar: command.avatar,
            }),
            'form-digest',
        );
        expect(hash).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });
    it.each(['subject', 'key', 'deadline'] as const)(
        'rejects upload proof with a mismatched %s before hashing',
        async (field) => {
            const claims = await verifyUploadToken('proof', AdminUploadTokenType.ACTIVATION);
            verifyUploadToken.mockResolvedValueOnce({
                ...claims,
                ...(field === 'subject'
                    ? { sub: 'another-admin' }
                    : field === 'key'
                      ? { fileKey: 'another-key' }
                      : { exp: claims.exp + 1 }),
            });
            await expect(handler.execute(command)).rejects.toBeInstanceOf(InvalidInputException);
            expect(hash).not.toHaveBeenCalled();
            expect(save).not.toHaveBeenCalled();
            expect(record).not.toHaveBeenCalled();
        },
    );
});
