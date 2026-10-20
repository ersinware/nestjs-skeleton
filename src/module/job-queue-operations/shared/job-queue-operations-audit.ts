/**
 * @file job-queue-operations-audit.ts
 * @description Audit actions owned by the job queue operations workflows.
 */

import { defineAuditAction } from 'src/shared/domain/audit';

/**
 * Audit actions owned by the job queue operations workflows.
 */
export const JobQueueOperationsAuditAction = {
    /**
     * An operator discarded exact jobs from the shared dead-letter queue.
     */
    JOB_DEAD_LETTER_DISCARDED: defineAuditAction('JOB_DEAD_LETTER_DISCARDED'),

    /**
     * An operator durably requested a shared dead-letter redrive operation.
     */
    JOB_DEAD_LETTER_REDRIVE_REQUESTED: defineAuditAction('JOB_DEAD_LETTER_REDRIVE_REQUESTED'),
} as const;
