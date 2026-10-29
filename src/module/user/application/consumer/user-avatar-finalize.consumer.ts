/**
 * @file user-avatar-finalize.consumer.ts
 * @description Dispatches initial user avatar finalization through the owning command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { type IJobConsumer, type Job } from 'src/core/job-queue';
import { FinalizeUserAvatarCommand } from 'src/module/user/application/command/finalize-user-avatar/command';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';

/**
 * Uses the existing retry defaults and shared DLQ for storage reconciliation.
 */
@Injectable()
export class UserAvatarFinalizeConsumer implements IJobConsumer {
    /**
     * Queue owned by the registered user's avatar workflow.
     */
    readonly name = UserJobQueue.AVATAR_FINALIZE;

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
     * Dispatches work using only durable aggregate and delivery identities.
     *
     * @param job Initial registration avatar delivery
     */
    async consume(job: Job) {
        await this.commandPipeline.execute(new FinalizeUserAvatarCommand(job.aggregateId, job.deliveryId));
    }
}
