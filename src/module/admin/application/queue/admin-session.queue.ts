/**
 * @file admin-session.queue.ts
 * @description Dispatches admin session reconciliation jobs to the command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { IJobConsumer, Job } from 'src/core/job-queue';
import { ReconcileAdminSessionCommand } from 'src/module/admin/application/command/reconcile-admin-session/command';
import { AdminJobQueue } from 'src/module/admin/domain/job/admin-job-queue.enum';

/**
 * Consumes durable admin session reconciliation jobs.
 */
@Injectable()
export class AdminSessionQueue implements IJobConsumer {
    /**
     * Queue handled by this consumer.
     */
    readonly name = AdminJobQueue.SESSION_RECONCILE;

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
     * Dispatches session reconciliation for the referenced admin.
     *
     * @param job Session reconciliation job
     */
    async consume(job: Job) {
        await this.commandPipeline.execute(new ReconcileAdminSessionCommand(job.aggregateId));
    }
}
