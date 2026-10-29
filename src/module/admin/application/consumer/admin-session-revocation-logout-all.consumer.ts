/**
 * @file admin-session-revocation-logout-all.consumer.ts
 * @description Dispatches logout-all revocation jobs to the admin command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { IJobConsumer, Job } from 'src/core/job-queue';
import { RevokeAdminSessionsCommand } from 'src/module/admin/application/command/revoke-admin-sessions/command';
import { AdminSessionRevocationJobQueue } from 'src/shared/domain/admin';
import { SessionRevocationReason } from 'src/shared/domain/principal';

/**
 * Consumes logout-all revocation jobs for admins.
 */
@Injectable()
export class AdminSessionRevocationLogoutAllConsumer implements IJobConsumer {
    /**
     * Queue handled by this consumer.
     */
    readonly name = AdminSessionRevocationJobQueue.LOGOUT_ALL;

    /**
     * Revocation state, audit, produced jobs, and job completion must commit together.
     */
    readonly transactional = true;

    /**
     * Keeps revocation polling prompt without grouping transactional effects.
     */
    readonly workerOptions = { localConcurrency: 1, pollingIntervalSeconds: 1, batchSize: 1 } as const;

    /**
     * Initializes the consumer with the required pipeline.
     *
     * @param commandPipeline Pipeline used to dispatch revocation commands
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches a logout-all revocation command for the referenced admin.
     *
     * @param job Logout-all revocation job
     */
    async consume(job: Job) {
        await this.commandPipeline.execute(
            new RevokeAdminSessionsCommand(job.aggregateId, SessionRevocationReason.LOGOUT_ALL, job.deliveryId),
        );
    }
}
