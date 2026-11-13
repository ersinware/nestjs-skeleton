/**
 * @file handler.spec.ts
 * @description Verifies stable logical delivery, terminal payload conflicts, and recoverable email failures.
 */

import { ConfigService } from '@nestjs/config';
import type { IEmailerPort } from 'src/core/email';
import type { ITokenPort } from 'src/core/security/token';
import { SendUserActivationCommand } from 'src/module/user/application/command/send-user-activation/command';
import { SendUserActivationCommandHandler } from 'src/module/user/application/command/send-user-activation/handler';
import type { USER_ACTIVATION_TOKEN_TYPE } from 'src/module/user/application/user-activation-token';
import {
    DependencyUnavailableException,
    ExceptionKind,
    ResourceConflictException,
    SystemException,
} from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

describe('SendUserActivationCommandHandler', () => {
    /**
     * Supplies delivery ports without replacing application behavior.
     *
     * @returns Handler, logical delivery, and observable outbound ports
     */
    function fixture() {
        const sendEmail = vi.fn<IEmailerPort['sendEmail']>().mockResolvedValue(undefined);
        const read = vi.fn().mockResolvedValue({
            name: 'Pending',
            email: 'target@example.test',
            activationId: 'delivery',
            activationExpiresAt: new Date('2027-01-01'),
            activationRevocationVersion: 3,
        });
        const sign = vi.fn().mockResolvedValue('fixed-token');
        const token = { sign } as unknown as ITokenPort<typeof USER_ACTIVATION_TOKEN_TYPE>;
        const handler = new SendUserActivationCommandHandler(
            { getActivationRecipient: read },
            token,
            { sendEmail },
            new ConfigService({ USER_ACTIVATION_URL: 'https://frontend.example.test/confirm' }),
        );
        return {
            handler,
            sendEmail,
            read,
            sign,
            command: new SendUserActivationCommand('account', 'delivery', 'queue'),
        };
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
        expect(f.sign).not.toHaveBeenCalled();
    });
});
