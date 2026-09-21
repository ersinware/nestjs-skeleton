/**
 * @file job-queue-operations-reader.adapter.ts
 * @description Adapts job-queue read operations to purpose-specific module query ports.
 */

import { Inject, Injectable } from '@nestjs/common';
import { TOKEN_JOB_QUEUE_DEAD_LETTER_READER_PORT, type IJobQueueDeadLetterReaderPort } from 'src/core/job-queue';
import type { IGetDeadLetterJobPort } from 'src/module/job-queue-operations/application/query/get-dead-letter-job/port';
import type { GetDeadLetterJobResult } from 'src/module/job-queue-operations/application/query/get-dead-letter-job/query';
import type { IListDeadLetterJobsPort } from 'src/module/job-queue-operations/application/query/list-dead-letter-jobs/port';
import type { ListDeadLetterJobsResult } from 'src/module/job-queue-operations/application/query/list-dead-letter-jobs/query';
import type { PaginationParams } from 'src/shared/pagination';

/**
 * Keeps pg-boss access behind the core port while separating the module's query contracts.
 */
@Injectable()
export class JobQueueOperationsReaderAdapter implements IListDeadLetterJobsPort, IGetDeadLetterJobPort {
    /**
     * Initializes the reader with the shared dead-letter read port.
     *
     * @param port Core dead-letter reader
     */
    constructor(
        @Inject(TOKEN_JOB_QUEUE_DEAD_LETTER_READER_PORT) private readonly port: IJobQueueDeadLetterReaderPort,
    ) {}

    /**
     * Reads one bounded page.
     *
     * @param params Pagination request
     * @returns Sanitized page and count
     */
    async listJobs(params: PaginationParams): Promise<ListDeadLetterJobsResult> {
        return this.port.listDeadLetterJobs(params);
    }

    /**
     * Reads one job from the shared queue.
     *
     * @param id Dead-letter job identifier
     * @returns Job or null when absent
     */
    async getJob(id: string): Promise<GetDeadLetterJobResult | null> {
        return this.port.getDeadLetterJob(id);
    }
}
