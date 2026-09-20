/**
 * @file user-session.queue.ts
 * @description Dispatches user session reconciliation jobs to the command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { type IJobConsumer, type Job } from 'src/core/job-queue';
import { ReconcileUserSessionCommand } from 'src/module/user/application/command/reconcile-user-session/command';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';

/**
 * Consumes durable user session reconciliation jobs.
 */
@Injectable()
export class UserSessionQueue implements IJobConsumer {
    /**
     * Queue handled by this consumer.
     */
    readonly name = UserJobQueue.SESSION_RECONCILE;

    /**
     * Redis synchronization cannot participate in the queue transaction.
     */
    readonly transactional = false;

    /**
     * Initializes the consumer with the required pipeline.
     *
     * @param commandPipeline Pipeline used to dispatch reconciliation commands
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches session reconciliation for the referenced user.
     *
     * @param job Session reconciliation job
     */
    async consume(job: Job) {
        await this.commandPipeline.execute(new ReconcileUserSessionCommand(job.aggregateId));
    }
}
