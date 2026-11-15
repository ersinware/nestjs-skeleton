/**
 * @file job-queue-operations-dead-letter-reader.adapter.ts
 * @description Adapts job-queue read operations to purpose-specific module query ports.
 */

import { Inject, Injectable } from '@nestjs/common';
import {
    TOKEN_JOB_QUEUE_DEAD_LETTER_READER_PORT,
    type DeadLetterRedrive,
    type IJobQueueDeadLetterReaderPort,
} from 'src/core/job-queue';
import type { IListDeadLetterRedrivesPort } from 'src/module/job-queue-operations/application/query/list-dead-letter-redrives/port';
import type {
    DeadLetterRedriveStatus,
    ListDeadLetterRedrivesResult,
} from 'src/module/job-queue-operations/application/query/list-dead-letter-redrives/query';
import type { PaginationParams } from 'src/shared/pagination';

/**
 * Exhaustive mapping from pg-boss states to public redrive statuses.
 */
const STATUS_BY_STATE = {
    created: 'ACCEPTED',
    retry: 'ACCEPTED',
    active: 'RUNNING',
    completed: 'COMPLETED',
    failed: 'FAILED',
    cancelled: 'CANCELLED',
} as const satisfies Record<DeadLetterRedrive['state'], DeadLetterRedriveStatus>;

/**
 * Keeps pg-boss access behind the core port while separating the module's query contracts.
 */
@Injectable()
export class JobQueueOperationsDeadLetterReaderAdapter implements IListDeadLetterRedrivesPort {
    /**
     * Initializes the reader with the shared dead-letter read port.
     *
     * @param port Core dead-letter reader
     */
    constructor(
        @Inject(TOKEN_JOB_QUEUE_DEAD_LETTER_READER_PORT) private readonly port: IJobQueueDeadLetterReaderPort,
    ) {}

    /**
     * Reads and maps one newest-first page of retained redrive orchestration jobs.
     *
     * @param params Pagination request
     * @returns Sanitized operation page and total count
     */
    async listDeadLetterRedrives(params: PaginationParams): Promise<ListDeadLetterRedrivesResult> {
        const page = await this.port.listDeadLetterRedrives(params);

        return {
            data: page.data.map((operation) => ({
                id: operation.id,
                status: STATUS_BY_STATE[operation.state],
                createdOn: operation.createdOn,
                completedOn: operation.completedOn,
            })),
            total: page.total,
        };
    }
}
