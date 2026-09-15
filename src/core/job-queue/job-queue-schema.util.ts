/**
 * @file job-queue-schema.util.ts
 * @description Read-only checks shared by deployment provisioning and application startup.
 */

import type { PgBoss, Queue } from 'pg-boss';
import { SystemException } from 'src/shared/exception';

/**
 * Rejects incomplete migrations or queue configuration that differs from the deployment contract.
 *
 * @param boss Started schema client
 * @param schema Schema name for diagnostics
 * @param expectedQueues Expected source and dead-letter queues
 * @throws {SystemException} If migration work remains or queue configuration differs.
 * @throws {Error} If the database inspection fails.
 */
export async function assertJobQueueSchema(boss: PgBoss, schema: string, expectedQueues: readonly Queue[]) {
    if ((await boss.getBamStatus()).some((entry) => entry.status !== 'completed' && entry.count > 0)) {
        throw new SystemException(`Incomplete delivery migrations: ${schema}.`);
    }

    const actualQueues = await boss.getQueues(expectedQueues.map((queue) => queue.name));

    for (const expectedQueue of expectedQueues) {
        const actualQueue = actualQueues.find((queue) => queue.name === expectedQueue.name);

        if (
            !actualQueue ||
            actualQueue.policy !== expectedQueue.policy ||
            actualQueue.partition !== expectedQueue.partition ||
            actualQueue.notify !== expectedQueue.notify ||
            (actualQueue.deadLetter ?? null) !== (expectedQueue.deadLetter ?? null) ||
            actualQueue.retentionSeconds !== expectedQueue.retentionSeconds ||
            actualQueue.deleteAfterSeconds !== expectedQueue.deleteAfterSeconds
        ) {
            throw new SystemException(`Delivery queue requires provisioning: ${schema}.${expectedQueue.name}.`);
        }
    }
}
