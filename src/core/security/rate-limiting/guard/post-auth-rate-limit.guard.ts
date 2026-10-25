/**
 * @file post-auth-rate-limit.guard.ts
 * @description Runs declared admission counters after authentication and before authorization.
 */

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { RateLimitStage } from 'src/core/security/rate-limiting/rate-limit-stage';
import { RateLimitStageRunner } from 'src/core/security/rate-limiting/rate-limit-stage.runner';

/**
 * Post-auth stage; policies without applicable counters perform no storage operation.
 */
@Injectable()
export class PostAuthRateLimitGuard implements CanActivate {
    /**
     * Connects post-auth admission to the shared policy runner.
     *
     * @param runner Shared policy executor.
     */
    constructor(private readonly runner: RateLimitStageRunner) {}

    /**
     * Checks the endpoint counters assigned to the post-auth stage.
     *
     * @param context Current HTTP execution context.
     * @returns Admission result; failures follow the runner's taxonomy contract.
     * @throws {RateLimitedException} When a configured counter blocks admission.
     * @throws {DependencyUnavailableException} When a required check cannot complete.
     * @throws {InvalidInputException} When a configured client source is invalid.
     * @throws {SystemException} When policy or server-established source data is invalid.
     */
    canActivate(context: ExecutionContext): Promise<boolean> {
        return this.runner.run(context, RateLimitStage.POST_AUTH);
    }
}
