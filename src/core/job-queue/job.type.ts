/**
 * @file job.type.ts
 * @description Defines the payload delivered to a job consumer.
 */

import type { JobDefinition } from 'src/shared/domain/job';

/**
 * Durable job data without its routing queue.
 */
export type Job = Omit<JobDefinition, 'queueName'> & {
    /**
     * Optional W3C producer span reference; older and untraced jobs omit it.
     */
    readonly traceparent?: string;
};
