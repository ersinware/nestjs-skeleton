/**
 * @file port.ts
 * @description Outbound read contract for one redrive operation status.
 */

import type { GetDeadLetterRedriveStatusResult } from 'src/module/job-queue-operations/application/query/get-dead-letter-redrive-status/query';

/**
 * Dependency injection token for the {@link IGetDeadLetterRedriveStatusPort} contract.
 */
export const TOKEN_GET_DEAD_LETTER_REDRIVE_STATUS_PORT = Symbol();

/**
 * Reads persisted redrive status without exposing the pg-boss client.
 */
export interface IGetDeadLetterRedriveStatusPort {
    /**
     * Retrieves the public status of one retained orchestration job.
     *
     * @param operationId Redrive operation identifier
     * @returns Sanitized operation status, or null when absent
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     */
    getRedriveStatus(operationId: string): Promise<GetDeadLetterRedriveStatusResult | null>;
}
