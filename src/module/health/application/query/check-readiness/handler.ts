/**
 * @file handler.ts
 * @description Handles the CheckReadinessQuery through the shared health read port.
 */

import { Inject } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { ICheckReadinessPort } from 'src/module/health/application/query/check-readiness/port';
import { TOKEN_CHECK_READINESS_PORT } from 'src/module/health/application/query/check-readiness/port';
import { CheckReadinessQuery } from 'src/module/health/application/query/check-readiness/query';

/**
 * Resolves the CheckReadinessQuery by delegating to the readiness branch in the adapter.
 */
@QueryHandler(CheckReadinessQuery)
export class CheckReadinessQueryHandler implements IQueryHandler<CheckReadinessQuery, void> {
    /**
     * Creates the handler.
     *
     * @param port The read port executing health checks.
     */
    constructor(@Inject(TOKEN_CHECK_READINESS_PORT) private readonly port: ICheckReadinessPort) {}

    /**
     * Executes the query.
     *
     * @throws {ServiceUnavailableException} When a checked health indicator fails
     */
    async execute(): Promise<void> {
        await this.port.checkReadiness();
    }
}
