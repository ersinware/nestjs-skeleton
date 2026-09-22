/**
 * @file job-queue-provisioner.ts
 * @description Creates application queues and reconciles their supported options.
 */

import { type PgBoss, type Queue, type UpdateQueueOptions } from 'pg-boss';
import { JOB_QUEUE_DEAD_LETTER } from 'src/core/job-queue/dead-letter-queue.constant';
import type { JobQueueOptions } from 'src/core/job-queue/job-consumer.interface';
import { SystemException } from 'src/shared/exception';

/**
 * Mutable defaults applied to every application-owned queue at startup.
 */
const JOB_QUEUE_MUTABLE_DEFAULTS = {
    retryLimit: 10,
    retryDelay: 15,
    retryBackoff: true,
} as const satisfies UpdateQueueOptions;

/**
 * Creates a queue when missing and reconciles its application-owned options.
 *
 * @param boss Shared pg-boss client
 * @param name Queue name
 * @param options Expected queue topology
 * @throws {SystemException} When immutable queue options conflict with the application topology
 */
export async function provisionJobQueue(boss: PgBoss, name: string, options: JobQueueOptions) {
    const deadLetter = options.disableDeadLetter ? null : JOB_QUEUE_DEAD_LETTER;

    await boss.createQueue(name, {
        ...JOB_QUEUE_MUTABLE_DEFAULTS,
        policy: options.policy,
        partition: false,
        ...(deadLetter === null ? {} : { deadLetter }),
    });

    const queue = await boss.getQueue(name);
    if (queue?.policy !== options.policy || queue.partition !== false) {
        throw new SystemException(
            `Job queue "${name}" has immutable options incompatible with the application configuration.`,
            {
                context: { class: provisionJobQueue.name, method: provisionJobQueue.name },
            },
        );
    }

    const mutableOptions = {
        ...JOB_QUEUE_MUTABLE_DEFAULTS,
        deadLetter,
    } as const satisfies UpdateQueueOptions;

    if (hasMutableOptionMismatch(queue, mutableOptions)) {
        await boss.updateQueue(name, mutableOptions);
    }
}

/**
 * Determines whether persisted mutable options differ from the expected topology.
 *
 * @param queue Persisted pg-boss queue metadata
 * @param options Expected mutable options
 * @returns True when the queue must be updated
 */
function hasMutableOptionMismatch(queue: Queue, options: UpdateQueueOptions): boolean {
    return (
        queue.retryLimit !== options.retryLimit ||
        queue.retryDelay !== options.retryDelay ||
        queue.retryBackoff !== options.retryBackoff ||
        (queue.deadLetter ?? null) !== options.deadLetter
    );
}
