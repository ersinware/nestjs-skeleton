/**
 * @file port.ts
 * @description Outbound read contract for listing retained dead-letter redrive operations.
 */

import type { ListDeadLetterRedrivesResult } from 'src/module/job-queue-operations/application/query/list-dead-letter-redrives/query';
import type { PaginationParams } from 'src/shared/pagination';

/**
 * Dependency injection token for the {@link IListDeadLetterRedrivesPort} contract.
 */
export const TOKEN_LIST_DEAD_LETTER_REDRIVES_PORT = Symbol();

/**
 * Reads a bounded page of retained dead-letter redrives.
 */
export interface IListDeadLetterRedrivesPort {
    /**
     * Reads one newest-first page from the retained redrive orchestration queue.
     *
     * @param params Page and limit
     * @returns Sanitized page and matching count
     * @throws {DependencyUnavailableException} When PostgreSQL is unavailable
     */
    listDeadLetterRedrives(params: PaginationParams): Promise<ListDeadLetterRedrivesResult>;
}
