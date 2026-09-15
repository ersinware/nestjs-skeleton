/**
 * @file job-queue-migration.ts
 * @description One-off deployment entry point for vendor migrations and queue provisioning.
 */

import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { ENV, resolveEnvFilePath, validateConfig } from 'src/core/config';
import { assertJobQueueSchema } from 'src/core/job-queue/job-queue-schema.util';
import { createJobQueueTopology } from 'src/core/job-queue/job-queue-topology.util';
import type { JobQueueDefinition } from 'src/core/job-queue/port/job-queue.port';
import { SystemException } from 'src/shared/exception';

/**
 * Loads validated configuration without starting HTTP, consumers, or business dependencies.
 */
@Module({
    imports: [ConfigModule.forRoot({ envFilePath: resolveEnvFilePath(), validate: validateConfig })],
})
class JobQueueMigrationModule {}

/**
 * Applies pg-boss DDL with deployment credentials; never called from application startup.
 * Background migration completion and index drift are checked before successful exit.
 *
 * @param definitions Queue inventories supplied by the deployment composition root
 */
export async function migrateJobQueues(definitions: readonly JobQueueDefinition[]) {
    try {
        const app = await NestFactory.createApplicationContext(JobQueueMigrationModule, {
            logger: false,
            abortOnError: false,
        });

        try {
            const config = app.get(ConfigService),
                timeout = config.getOrThrow<number>(ENV.DELIVERY_MIGRATION_TIMEOUT) * 1000,
                pool = new Pool({
                    connectionString: config.getOrThrow<string>(ENV.DATABASE_URL),
                    max: 1,
                    connectionTimeoutMillis: config.getOrThrow<number>(ENV.DATABASE_CONNECT_TIMEOUT) * 1000,
                    // DDL needs its own budget, independent of short request-path timeouts.
                    statement_timeout: timeout,
                    query_timeout: timeout,
                    options: '-c TimeZone=UTC',
                });

            let backgroundError: Error | undefined;

            pool.on('error', (error) => {
                backgroundError = error;
                console.error('Delivery migration pool error.', error);
                process.exitCode = 1;
            });

            try {
                for (const { schema, queues } of definitions.map(createJobQueueTopology)) {
                    if (backgroundError) {
                        break;
                    }

                    const boss = new PgBoss({
                        schema,
                        db: { executeSql: (text, values) => pool.query(text, values) },
                        migrate: true,
                        supervise: false,
                        schedule: false,
                        useListenNotify: false,
                        reindex: false,
                        bamIntervalSeconds: 10,
                    });

                    boss.on('error', (error) => {
                        backgroundError = error;
                        console.error(`Delivery migration background error: ${schema}.`, error);
                        process.exitCode = 1;
                    });

                    boss.on('warning', (warning) => {
                        console.warn(`${schema}: ${warning.message}`);
                    });

                    try {
                        await boss.start();

                        // DLQs precede sources. createQueue preserves existing settings, so reconcile
                        // mutable settings explicitly; immutable policy drift must fail inspection.
                        for (const queue of queues) {
                            await boss.createQueue(queue.name, queue);
                            await boss.updateQueue(queue.name, {
                                retentionSeconds: queue.retentionSeconds!,
                                deleteAfterSeconds: queue.deleteAfterSeconds!,
                                notify: false,
                                deadLetter: queue.deadLetter ?? null,
                            });
                        }

                        const deadline = Date.now() + timeout;

                        while (
                            (await boss.getBamStatus()).some((entry) => entry.status !== 'completed' && entry.count > 0)
                        ) {
                            if (backgroundError) {
                                break;
                            }

                            if (Date.now() >= deadline) {
                                throw new SystemException(`Delivery background migration timed out: ${schema}.`);
                            }

                            await delay(1000);
                        }

                        if (backgroundError) {
                            break;
                        }

                        await assertJobQueueSchema(boss, schema, queues);

                        const drift = await boss.detectSchemaDrift();

                        if (!drift.ok || drift.building.length > 0) {
                            throw new SystemException(`Delivery schema drift requires operator review: ${schema}.`);
                        }

                        if (backgroundError) {
                            break;
                        }

                        console.info(`Delivery storage provisioned: ${schema}.`);
                    } finally {
                        await boss.stop({ close: false }).catch((error: unknown) => {
                            console.error(`Delivery migration client shutdown failed: ${schema}.`, error);
                            process.exitCode = 1;
                        });
                    }

                    if (process.exitCode === 1) {
                        break;
                    }
                }
            } finally {
                await pool.end().catch((error: unknown) => {
                    console.error('Delivery migration pool shutdown failed.', error);
                    process.exitCode = 1;
                });
            }
        } finally {
            await app.close().catch((error: unknown) => {
                console.error('Delivery migration application shutdown failed.', error);
                process.exitCode = 1;
            });
        }
    } catch (error) {
        console.error('Delivery migration failed.', error);
        process.exitCode = 1;
    }
}
