/**
 * @file admin-email-confirmation.consumer.spec.ts
 * @description Verifies durable recipient validation and logical email identity propagation.
 */

import type { CommandPipeline } from 'src/core/cqrs';
import type { Job } from 'src/core/job-queue';
import { SendAdminEmailConfirmationCommand } from 'src/module/admin/application/command/send-admin-email-confirmation/command';
import { AdminEmailConfirmationConsumer } from 'src/module/admin/application/consumer/admin-email-confirmation.consumer';
import { ExceptionKind } from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

describe('AdminEmailConfirmationConsumer', () => {
    it('forwards the same immutable recipient and logical identity on retry', async () => {
        const execute = vi.fn().mockResolvedValue(undefined);
        const consumer = new AdminEmailConfirmationConsumer({ execute } as unknown as CommandPipeline);
        const job: Job = {
            aggregateId: 'account',
            deliveryId: 'delivery',
            payload: {
                recipientName: 'Original',
            },
        };
        await consumer.consume(job);
        await consumer.consume(job);
        expect(execute).toHaveBeenCalledTimes(2);
        expect(execute.mock.calls[0]![0]).toEqual(
            new SendAdminEmailConfirmationCommand(job.aggregateId, job.deliveryId, consumer.name, 'Original'),
        );
        expect(execute.mock.calls[1]).toEqual(execute.mock.calls[0]);
        expect(consumer.transactional).toBe(false);
    });

    it.each([undefined, {}, { recipientName: null }, { recipientName: 123 }])(
        'terminates malformed durable payload %s before dispatch',
        async (payload) => {
            const execute = vi.fn();
            const consumer = new AdminEmailConfirmationConsumer({ execute } as unknown as CommandPipeline);
            await expect(
                consumer.consume({
                    aggregateId: 'account',
                    deliveryId: 'delivery',
                    ...(payload === undefined ? {} : { payload }),
                }),
            ).rejects.toMatchObject({ kind: ExceptionKind.TERMINAL_JOB });
            expect(execute).not.toHaveBeenCalled();
        },
    );
});
