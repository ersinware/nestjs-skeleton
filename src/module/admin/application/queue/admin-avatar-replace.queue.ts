/**
 * @file admin-avatar-replace.queue.ts
 * @description Dispatches admin profile avatar replacement through the owning command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { type IJobConsumer, type Job } from 'src/core/job-queue';
import { ReplaceAdminAvatarCommand } from 'src/module/admin/application/command/replace-admin-avatar/command';
import { AdminJobQueue } from 'src/module/admin/domain/job/admin-job-queue.enum';
import { TerminalJobException } from 'src/shared/exception';

/**
 * Uses the existing retry defaults and shared DLQ for storage reconciliation.
 */
@Injectable()
export class AdminAvatarReplaceQueue implements IJobConsumer {
    /**
     * Queue owned by the admin's profile avatar workflow.
     */
    readonly name = AdminJobQueue.AVATAR_REPLACE;

    /**
     * Storage network calls cannot share the pg-boss transaction.
     */
    readonly transactional = false;

    /**
     * Limits storage concurrency without claiming work behind a slow delivery.
     */
    readonly workerOptions = { localConcurrency: 1, pollingIntervalSeconds: 5, batchSize: 1 } as const;

    /**
     * Initializes the owner command dispatcher.
     *
     * @param commandPipeline Dispatches the reconciliation command with normal behaviors
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Validates the cleanup fact before dispatching the replacement delivery.
     *
     * @param job Profile avatar replacement delivery
     * @throws {TerminalJobException} When the previous avatar identity is missing or invalid
     */
    async consume(job: Job) {
        const previousAvatarId = job.payload?.['previousAvatarId'];

        if (typeof previousAvatarId !== 'string' || previousAvatarId.length === 0) {
            throw new TerminalJobException('The avatar replacement job is missing its previous avatar identity.');
        }

        await this.commandPipeline.execute(
            new ReplaceAdminAvatarCommand(job.aggregateId, job.deliveryId, previousAvatarId),
        );
    }
}
