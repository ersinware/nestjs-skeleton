/**
 * @file user-avatar.queue.ts
 * @description Dispatches initial user avatar moves through the owning command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { type IJobConsumer, type Job } from 'src/core/job-queue';
import { MoveUserAvatarCommand } from 'src/module/user/application/command/move-user-avatar/command';
import { UserJobQueue } from 'src/module/user/domain/job/user-job-queue.enum';

/**
 * Uses the existing retry defaults and shared DLQ for storage reconciliation.
 */
@Injectable()
export class UserAvatarQueue implements IJobConsumer {
    /**
     * Queue owned by the registered user's avatar workflow.
     */
    readonly name = UserJobQueue.AVATAR_MOVE;

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
     * @param job Avatar move delivery
     */
    async consume(job: Job) {
        await this.commandPipeline.execute(new MoveUserAvatarCommand(job.aggregateId, job.deliveryId));
    }
}
