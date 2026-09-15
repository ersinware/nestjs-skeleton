/**
 * @file delivery-schema.util.ts
 * @description Read-only checks shared by deployment provisioning and application startup.
 */

import type { PgBoss, Queue } from 'pg-boss';
import { SystemException } from 'src/shared/exception';

/**
 * Rejects incomplete migrations or queue configuration that differs from the deployment contract.
 *
 * @param boss Started schema client
 * @param schema Schema name for diagnostics
 * @param expected Expected source and dead-letter queues
 * @throws {SystemException} If migration work remains or queue configuration differs.
 * @throws {Error} If the database inspection fails.
 */
export async function assertDeliverySchema(boss: PgBoss, schema: string, expected: readonly Queue[]) {
    if ((await boss.getBamStatus()).some((entry) => entry.status !== 'completed' && entry.count > 0)) {
        throw new SystemException(`Incomplete delivery migrations: ${schema}.`);
    }

    const queues = await boss.getQueues(expected.map((queue) => queue.name));

    for (const definition of expected) {
        const actual = queues.find((queue) => queue.name === definition.name);

        if (
            !actual ||
            actual.policy !== definition.policy ||
            actual.partition !== definition.partition ||
            actual.notify !== definition.notify ||
            (actual.deadLetter ?? null) !== (definition.deadLetter ?? null) ||
            actual.retentionSeconds !== definition.retentionSeconds ||
            actual.deleteAfterSeconds !== definition.deleteAfterSeconds
        ) {
            throw new SystemException(`Delivery queue requires provisioning: ${schema}.${definition.name}.`);
        }
    }
}
