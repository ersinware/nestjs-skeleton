/**
 * @file dead-letter-queue.ts
 * @description Defines the application-owned dead-letter queue names.
 */

import type { JobQueueOptions } from 'src/core/job-queue/job-consumer.interface';

/**
 * Shared queue that stores copies of jobs after their source retries are exhausted.
 */
export const JOB_QUEUE_DEAD_LETTER = 'application-dead-letter';

/**
 * Shared dead-letter queue topology; it is storage only and cannot dead-letter into itself.
 */
export const JOB_QUEUE_DEAD_LETTER_OPTIONS = {
    policy: 'standard',
    disableDeadLetter: true,
} as const satisfies JobQueueOptions;

/**
 * Exclusive queue that coordinates application-wide dead-letter redrive operations.
 */
export const JOB_QUEUE_DEAD_LETTER_REDRIVE = 'application-dead-letter-redrive';

/**
 * Redrive orchestration topology; exclusivity serializes operations across replicas.
 */
export const JOB_QUEUE_DEAD_LETTER_REDRIVE_OPTIONS = {
    policy: 'exclusive',
    disableDeadLetter: true,
} as const satisfies JobQueueOptions;
