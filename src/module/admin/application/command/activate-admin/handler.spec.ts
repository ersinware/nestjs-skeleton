/**
 * @file handler.spec.ts
 * @description Activation preserves business refusal kinds and evidence while preventing rejected writes.
 */

import type { ITransactionPort } from 'src/core/database';
import type { IAuditPort } from 'src/core/observability/audit';
import type { IHashingPort } from 'src/core/security/hashing';
import { AuthTokenType, type ITokenPort } from 'src/core/security/token';
import { ActivateAdminCommand } from 'src/module/admin/application/command/activate-admin/command';
import { ActivateAdminCommandHandler } from 'src/module/admin/application/command/activate-admin/handler';
import type { IAdminWriterPort } from 'src/module/admin/application/command/port/admin-writer.port';
import { Admin } from 'src/module/admin/domain/aggregate/admin.aggregate';
import { DomainFailureAuditAction } from 'src/shared/domain/audit';
import {
    AccessDeniedException,
    ResourceConflictException,
    ResourceNotFoundException,
    SystemException,
} from 'src/shared/exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('ActivateAdminCommandHandler', () => {
    const load = vi.fn<IAdminWriterPort['load']>(),
        save = vi.fn<IAdminWriterPort['save']>(),
        record = vi.fn<IAuditPort['record']>(),
        verifyInviteToken = vi.fn<ITokenPort['verifyInviteToken']>(),
        hash = vi.fn<IHashingPort['hash']>(),
        transaction: ITransactionPort = { run: (work) => work() },
        command = new ActivateAdminCommand('invitation', 'new-password');
    let admin: Admin, handler: ActivateAdminCommandHandler;

    beforeEach(() => {
        admin = Admin.create({ id: 'admin-1', email: 'admin@example.test', name: 'Admin', password: null });
        load.mockResolvedValue(admin);
        save.mockResolvedValue(undefined);
        record.mockResolvedValue(undefined);
        hash.mockResolvedValue('hashed-password');
        verifyInviteToken.mockResolvedValue({
            sub: admin.id,
            jti: admin.inviteId!,
            exp: admin.inviteExpiresAt!.getTime() / 1000,
            inviteRevocationVersion: admin.inviteRevocationVersion!,
            type: AuthTokenType.INVITE,
        });
        handler = new ActivateAdminCommandHandler(
            transaction,
            { load, save },
            { verifyInviteToken } as unknown as ITokenPort,
            { hash } as unknown as IHashingPort,
            { record },
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
                    action: DomainFailureAuditAction.ADMIN_ACTIVATION_FAILED,
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
            audit: { action: DomainFailureAuditAction.ADMIN_ACTIVATION_FAILED, reason: 'ACCOUNT_BANNED' },
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
});
