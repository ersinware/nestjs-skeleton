/**
 * @file admin-avatar-replace.consumer.spec.ts
 * @description Verifies replacement delivery payload validation before command dispatch.
 */

import type { CommandPipeline } from 'src/core/cqrs';
import type { Job } from 'src/core/job-queue';
import { ReplaceAdminAvatarCommand } from 'src/module/admin/application/command/replace-admin-avatar/command';
import { AdminAvatarReplaceConsumer } from 'src/module/admin/application/consumer/admin-avatar-replace.consumer';
import { ExceptionKind } from 'src/shared/exception';
import { describe, expect, it, vi } from 'vitest';

describe('AdminAvatarReplaceConsumer', () => {
    it.each([undefined, {}, { previousAvatarId: '' }, { previousAvatarId: null }, { previousAvatarId: 1 }])(
        'rejects unusable cleanup payload %j without dispatch',
        async (payload) => {
            const execute = vi.fn();
            const consumer = new AdminAvatarReplaceConsumer({ execute } as unknown as CommandPipeline);
            const job: Job = {
                aggregateId: 'owner',
                deliveryId: 'new-avatar',
                ...(payload !== undefined && { payload }),
            };
            await expect(consumer.consume(job)).rejects.toMatchObject({ kind: ExceptionKind.TERMINAL_JOB });
            expect(execute).not.toHaveBeenCalled();
        },
    );

    it('dispatches the immutable previous identity and propagates command failures', async () => {
        const error = new Error('command failed');
        const execute = vi.fn().mockRejectedValueOnce(error);
        const consumer = new AdminAvatarReplaceConsumer({ execute } as unknown as CommandPipeline);
        const job: Job = {
            aggregateId: 'owner',
            deliveryId: 'new-avatar',
            payload: { previousAvatarId: 'old-avatar' },
        };
        await expect(consumer.consume(job)).rejects.toBe(error);
        expect(execute).toHaveBeenCalledExactlyOnceWith(
            new ReplaceAdminAvatarCommand('owner', 'new-avatar', 'old-avatar'),
        );
        expect(consumer.transactional).toBe(false);
    });
});
