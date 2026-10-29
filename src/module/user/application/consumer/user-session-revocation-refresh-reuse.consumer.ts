/**
 * @file user-session-revocation-refresh-reuse.consumer.ts
 * @description Dispatches refresh-token reuse revocation jobs to the user command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { type IJobConsumer, type Job } from 'src/core/job-queue';
import { RevokeUserSessionsCommand } from 'src/module/user/application/command/revoke-user-sessions/command';
import { SessionRevocationReason } from 'src/shared/domain/principal';
import { UserSessionRevocationJobQueue } from 'src/shared/domain/user';

/**
 * Consumes refresh-token reuse revocation jobs for users.
 */
@Injectable()
export class UserSessionRevocationRefreshReuseConsumer implements IJobConsumer {
    /**
     * Queue handled by this consumer.
     */
    readonly name = UserSessionRevocationJobQueue.REFRESH_REUSE;

    /**
     * Revocation state, audit, produced jobs, and job completion must commit together.
     */
    readonly transactional = true;

    /**
     * Keeps reuse revocation polling prompt without grouping transactional effects.
     */
    readonly workerOptions = { localConcurrency: 1, pollingIntervalSeconds: 1, batchSize: 1 } as const;

    /**
     * Initializes the consumer with the required pipeline.
     *
     * @param commandPipeline Pipeline used to dispatch revocation commands
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches a refresh-token reuse revocation command for the referenced user.
     *
     * @param job Refresh-token reuse revocation job
     */
    async consume(job: Job) {
        await this.commandPipeline.execute(
            new RevokeUserSessionsCommand(job.aggregateId, SessionRevocationReason.REFRESH_REUSE, job.deliveryId),
        );
    }
}
