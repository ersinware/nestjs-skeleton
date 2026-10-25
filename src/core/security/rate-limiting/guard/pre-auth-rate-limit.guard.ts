/**
 * @file pre-auth-rate-limit.guard.ts
 * @description Runs declared admission counters before authentication.
 */

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { RateLimitStage } from 'src/core/security/rate-limiting/rate-limit-stage';
import { RateLimitStageRunner } from 'src/core/security/rate-limiting/rate-limit-stage.runner';

/**
 * Pre-auth stage, ordered explicitly by the application composition root.
 */
@Injectable()
export class PreAuthRateLimitGuard implements CanActivate {
    /**
     * Connects pre-auth admission to the shared policy runner.
     *
     * @param runner Shared policy executor.
     */
    constructor(private readonly runner: RateLimitStageRunner) {}

    /**
     * Checks the endpoint counters assigned to the pre-auth stage.
     *
     * @param context Current HTTP execution context.
     * @returns Admission result; failures follow the runner's taxonomy contract.
     * @throws {RateLimitedException} When a configured counter blocks admission.
     * @throws {DependencyUnavailableException} When a required check cannot complete.
     * @throws {InvalidInputException} When a configured client source is invalid.
     * @throws {SystemException} When policy or server-established source data is invalid.
     */
    canActivate(context: ExecutionContext): Promise<boolean> {
        return this.runner.run(context, RateLimitStage.PRE_AUTH);
    }
}
