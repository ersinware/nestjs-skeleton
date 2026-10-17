/**
 * @file admin-avatar-finalize.queue.ts
 * @description Dispatches initial admin avatar finalization through the owning command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { type IJobConsumer, type Job } from 'src/core/job-queue';
import { FinalizeAdminAvatarCommand } from 'src/module/admin/application/command/finalize-admin-avatar/command';
import { AdminJobQueue } from 'src/module/admin/domain/job/admin-job-queue.enum';

/**
 * Uses the existing retry defaults and shared DLQ for storage reconciliation.
 */
@Injectable()
export class AdminAvatarFinalizeQueue implements IJobConsumer {
    /**
     * Queue owned by the activated admin's avatar workflow.
     */
    readonly name = AdminJobQueue.AVATAR_FINALIZE;

    /**
     * Storage network calls cannot share the pg-boss transaction.
     */
    readonly transactional = false;

    /**
     * Initializes the owner command dispatcher.
     *
     * @param commandPipeline Dispatches the reconciliation command with normal behaviors
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches work using only durable aggregate and delivery identities.
     *
     * @param job Initial activation avatar delivery
     */
    async consume(job: Job) {
        await this.commandPipeline.execute(new FinalizeAdminAvatarCommand(job.aggregateId, job.deliveryId));
    }
}
