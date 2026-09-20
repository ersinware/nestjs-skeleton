/**
 * @file user-session-revocation-logout-all.queue.ts
 * @description Dispatches logout-all revocation jobs to the user command pipeline.
 */

import { Injectable } from '@nestjs/common';
import { CommandPipeline } from 'src/core/cqrs';
import { type IJobConsumer, type Job } from 'src/core/job-queue';
import { RevokeUserSessionsCommand } from 'src/module/user/application/command/revoke-user-sessions/command';
import { SessionRevocationReason } from 'src/shared/domain/principal';

/**
 * Consumes logout-all revocation jobs for users.
 */
@Injectable()
export class UserSessionRevocationLogoutAllQueue implements IJobConsumer {
    /**
     * Queue handled by this consumer.
     */
    readonly name = 'user.session-revocation.logout-all.queue.v1';

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
     * Dispatches a logout-all revocation command for the referenced user.
     *
     * @param job Logout-all revocation job
     */
    async consume(job: Job) {
        await this.commandPipeline.execute(
            new RevokeUserSessionsCommand(job.aggregateId, SessionRevocationReason.LOGOUT_ALL),
        );
    }
}
