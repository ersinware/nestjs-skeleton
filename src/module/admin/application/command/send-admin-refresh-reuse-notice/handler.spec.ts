/**
 * @file handler.spec.ts
 * @description Verifies stable logical delivery, terminal payload conflicts, and recoverable email failures.
 */

import type { IEmailerPort } from 'src/core/email';
import { SendAdminRefreshReuseNoticeCommand } from 'src/module/admin/application/command/send-admin-refresh-reuse-notice/command';
import { SendAdminRefreshReuseNoticeCommandHandler } from 'src/module/admin/application/command/send-admin-refresh-reuse-notice/handler';
import {
    DependencyUnavailableException,
    ExceptionKind,
    ResourceConflictException,
    SystemException,
} from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

describe('SendAdminRefreshReuseNoticeCommandHandler', () => {
    /**
     * Supplies delivery ports without replacing application behavior.
     *
     * @returns Handler, logical delivery, and observable outbound ports
     */
    function fixture() {
        const sendEmail = vi.fn<IEmailerPort['sendEmail']>().mockResolvedValue(undefined);

        const handler = new SendAdminRefreshReuseNoticeCommandHandler({ sendEmail });
        return {
            handler,
            sendEmail,
            command: new SendAdminRefreshReuseNoticeCommand(
                'delivery',
                'queue',
                'original@example.test',
                'Original <Name>',
            ),
        };
    }

    it('retains payload and delivery identity across repeated attempts', async () => {
        const f = fixture();
        await f.handler.execute(f.command);

        await f.handler.execute(f.command);
        expect(f.sendEmail).toHaveBeenCalledTimes(2);
        expect(f.sendEmail.mock.calls[0]).toEqual(f.sendEmail.mock.calls[1]);
        expect(f.sendEmail.mock.calls[0]![1]).toEqual({ queueName: 'queue', deliveryId: 'delivery' });
        expect(f.sendEmail.mock.calls[0]![0].body).toContain('Original &lt;Name&gt;');
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
});
