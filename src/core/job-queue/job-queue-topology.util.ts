/**
 * @file job-queue-topology.util.ts
 * @description Builds vendor queue definitions from a caller-owned queue inventory.
 */

import type { Queue } from 'pg-boss';
import type { JobQueueDefinition } from 'src/core/job-queue/port/job-queue.port';

/**
 * Builds DLQs before sources so provisioning respects their dependency.
 *
 * @param definition Caller-owned schema and source queue names
 * @returns Provisioning definitions for the producer schema
 */
export function createJobQueueTopology(definition: JobQueueDefinition): {
    readonly schema: string;
    readonly queues: readonly Readonly<Queue>[];
} {
    const queues = definition.queues.map((name) => ({ name, deadLetter: `${name}.dlq` }));

    return {
        schema: definition.schema,
        queues: [...queues.map(({ deadLetter }) => ({ name: deadLetter })), ...queues].map(
            (queue): Queue => ({
                ...queue,
                policy: 'standard',
                partition: false,
                notify: false,
                retentionSeconds: 2592000,
                deleteAfterSeconds: 2592000,
            }),
        ),
    };
}
