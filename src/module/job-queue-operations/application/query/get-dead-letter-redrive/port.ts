/**
 * @file port.ts
 * @description Outbound read contract for one redrive operation status.
 */

import type { GetDeadLetterRedriveResult } from 'src/module/job-queue-operations/application/query/get-dead-letter-redrive/query';

/**
 * Dependency injection token for the redrive operation lookup.
 */
export const TOKEN_GET_DEAD_LETTER_REDRIVE_PORT = Symbol('TOKEN_GET_DEAD_LETTER_REDRIVE_PORT');

/**
 * Reads persisted redrive status without exposing the pg-boss client.
 */
export interface IGetDeadLetterRedrivePort {
    /**
     * Retrieves the public status of one retained orchestration job.
     *
     * @param operationId Redrive operation identifier
     * @returns Sanitized operation status, or null when absent
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     */
    getRedrive(operationId: string): Promise<GetDeadLetterRedriveResult | null>;
}
