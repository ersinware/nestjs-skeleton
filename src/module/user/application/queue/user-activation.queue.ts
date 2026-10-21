/**
 * @file user-activation.queue.ts
 * @description Dispatches user activation jobs to the command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { IJobConsumer, Job } from 'src/core/job-queue';
import { SendUserActivationCommand } from 'src/module/user/application/command/send-user-activation/command';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';

/**
 * Consumes durable user activation jobs.
 */
@Injectable()
export class UserActivationQueue implements IJobConsumer {
    /**
     * Queue handled by this consumer.
     */
    readonly name = UserJobQueue.ACTIVATION;

    /**
     * Email delivery cannot participate in the queue transaction.
     */
    readonly transactional = false;

    /**
     * Keeps activation delivery responsive with bounded sequential email batches.
     */
    readonly workerOptions = { localConcurrency: 2, pollingIntervalSeconds: 2, batchSize: 5 } as const;

    /**
     * Initializes the consumer with the required pipeline.
     *
     * @param commandPipeline Pipeline used to dispatch activation commands
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches an activation command for the referenced user.
     *
     * @param job Activation job
     */
    async consume(job: Job) {
        await this.commandPipeline.execute(new SendUserActivationCommand(job.aggregateId, job.deliveryId, this.name));
    }
}
