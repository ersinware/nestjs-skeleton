/**
 * @file handler.spec.ts
 * @description Verifies stable logical delivery, terminal payload conflicts, and recoverable email failures.
 */

import type { IEmailerPort } from 'src/core/email';
import { SendAdminEmailChangeNotificationCommand } from 'src/module/admin/application/command/send-admin-email-change-notification/command';
import { SendAdminEmailChangeNotificationCommandHandler } from 'src/module/admin/application/command/send-admin-email-change-notification/handler';
import {
    DependencyUnavailableException,
    ExceptionKind,
    ResourceConflictException,
    SystemException,
} from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

describe('SendAdminEmailChangeNotificationCommandHandler', () => {
    /**
     * Supplies delivery ports without replacing application behavior.
     *
     * @returns Handler, logical delivery, and observable outbound ports
     */
    function fixture() {
        const sendEmail = vi.fn<IEmailerPort['sendEmail']>().mockResolvedValue(undefined);
        const read = vi
            .fn()
            .mockResolvedValue({ previousEmail: 'old@example.test', createdAt: new Date('2026-01-01') });

        const handler = new SendAdminEmailChangeNotificationCommandHandler(
            { getEmailChangeNotificationRecipient: read },
            { sendEmail },
        );
        return { handler, sendEmail, read, command: new SendAdminEmailChangeNotificationCommand('delivery', 'queue') };
    }

    it('retains payload and delivery identity across repeated attempts', async () => {
        const f = fixture();
        await f.handler.execute(f.command);

        await f.handler.execute(f.command);
        expect(f.sendEmail).toHaveBeenCalledTimes(2);
        expect(f.sendEmail.mock.calls[0]).toEqual(f.sendEmail.mock.calls[1]);
        expect(f.sendEmail.mock.calls[0]![1]).toEqual({ queueName: 'queue', deliveryId: 'delivery' });
    });

    it('makes provider payload conflict terminal and preserves its cause', async () => {
        const f = fixture();
        const conflict = new ResourceConflictException('Provider payload conflict');
        f.sendEmail.mockRejectedValueOnce(conflict);
        await expect(f.handler.execute(f.command)).rejects.toMatchObject({
            kind: ExceptionKind.TERMINAL_JOB,
            cause: conflict,
        });
        expect(f.sendEmail).toHaveBeenCalledTimes(1);
    });

    it.each([new DependencyUnavailableException(), new SystemException('Unknown provider fault')])(
        'preserves retryable provider failures unchanged: %s',
        async (error) => {
            const f = fixture();
            f.sendEmail.mockRejectedValueOnce(error);
            await expect(f.handler.execute(f.command)).rejects.toBe(error);
        },
    );

    it('skips ineligible or missing authoritative delivery state without provider effects', async () => {
        const f = fixture();
        f.read.mockResolvedValue(null);
        await f.handler.execute(f.command);
        expect(f.sendEmail).not.toHaveBeenCalled();
    });
});
