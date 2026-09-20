/**
 * @file admin-session-revocation-refresh-reuse.queue.ts
 * @description Dispatches refresh-token reuse revocation jobs to the admin command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { IJobConsumer, Job } from 'src/core/job-queue';
import { RevokeAdminSessionsCommand } from 'src/module/admin/application/command/revoke-admin-sessions/command';
import { SessionRevocationReason } from 'src/shared/domain/principal';

/**
 * Consumes refresh-token reuse revocation jobs for admins.
 */
@Injectable()
export class AdminSessionRevocationRefreshReuseQueue implements IJobConsumer {
    /**
     * Queue handled by this consumer.
     */
    readonly name = 'admin.session-revocation.refresh-reuse.queue.v1';

    /**
     * Revocation state, audit, produced jobs, and job completion must commit together.
     */
    readonly transactional = true;

    /**
     * Initializes the consumer with the required pipeline.
     *
     * @param commandPipeline Pipeline used to dispatch revocation commands
     */
    constructor(private readonly commandPipeline: CommandPipeline) {}

    /**
     * Dispatches a refresh-token reuse revocation command for the referenced admin.
     *
     * @param job Refresh-token reuse revocation job
     */
    async consume(job: Job) {
        await this.commandPipeline.execute(
            new RevokeAdminSessionsCommand(job.aggregateId, SessionRevocationReason.REFRESH_REUSE),
        );
    }
}
