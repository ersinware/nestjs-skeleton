/**
 * @file job-queue-feature.module.spec.ts
 * @description Verifies worker configuration and source-versus-orchestration DLQ routing.
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { JobQueueDatabaseAdapter } from 'src/core/job-queue/adapter/job-queue-database.adapter';
import {
    JOB_QUEUE_DEAD_LETTER,
    JOB_QUEUE_DEAD_LETTER_REDRIVE,
    JOB_QUEUE_DEAD_LETTER_REDRIVE_OPTIONS,
} from 'src/core/job-queue/dead-letter-queue.constant';
import type { IJobConsumer } from 'src/core/job-queue/job-consumer.interface';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { JobQueueFeatureModule, TOKEN_FEATURE_CONSUMERS } from 'src/core/job-queue/job-queue-feature.module';
import { TOKEN_ERROR_REPORTER_PORT } from 'src/core/observability/error-reporter';
import { describe, expect, it, vi, type Mock } from 'vitest';

/**
 * Boots the production feature provider with in-memory pg-boss boundaries.
 *
 * @param consumers Queue contracts to register
 * @returns Configured provider and captured pg-boss operations
 */
async function setup(consumers: IJobConsumer[]): Promise<{
    readonly module: TestingModule;
    readonly feature: JobQueueFeatureModule;
    readonly boss: Readonly<Record<'createQueue' | 'getQueue' | 'updateQueue' | 'work', Mock>>;
}> {
    const boss = {
        createQueue: vi.fn().mockResolvedValue(undefined),
        getQueue: vi.fn((name: string) =>
            Promise.resolve({
                name,
                policy: name === JOB_QUEUE_DEAD_LETTER_REDRIVE ? 'exclusive' : 'standard',
                partition: false,
                retryLimit: 10,
                retryDelay: 15,
                retryBackoff: true,
                // Simulate queues created before DLQ activation.
                deadLetter: null,
            }),
        ),
        updateQueue: vi.fn().mockResolvedValue(undefined),
        work: vi.fn().mockResolvedValue('worker-id'),
    };
    const module = await Test.createTestingModule({
        providers: [
            JobQueueFeatureModule,
            { provide: TOKEN_JOB_QUEUE_CLIENT, useValue: boss },
            { provide: JobQueueDatabaseAdapter, useValue: {} },
            { provide: TOKEN_ERROR_REPORTER_PORT, useValue: { report: vi.fn() } },
            { provide: TOKEN_FEATURE_CONSUMERS, useValue: consumers },
        ],
    }).compile();
    return { module, feature: module.get(JobQueueFeatureModule), boss };
}

describe('JobQueueFeatureModule', () => {
    it('keeps source DLQ routing disabled and retains single-job transactional and Redis defaults', async () => {
        const { module, feature, boss } = await setup([
            { name: 'transactional-source', transactional: true, consume: vi.fn() },
            { name: 'redis-source', transactional: false, consume: vi.fn() },
        ]);
        try {
            await feature.onApplicationBootstrap();
            for (const name of ['transactional-source', 'redis-source']) {
                expect(boss.createQueue).toHaveBeenCalledWith(name, {
                    retryLimit: 10,
                    retryDelay: 15,
                    retryBackoff: true,
                    policy: 'standard',
                    partition: false,
                });
            }
            expect(boss.updateQueue).not.toHaveBeenCalled();
            expect(boss.work).toHaveBeenCalledWith(
                'transactional-source',
                {
                    batchSize: 1,
                    pollingIntervalSeconds: 1,
                    localConcurrency: 3,
                    transactional: true,
                },
                expect.any(Function),
            );
            expect(boss.work).toHaveBeenCalledWith(
                'redis-source',
                {
                    batchSize: 1,
                    pollingIntervalSeconds: 1,
                    localConcurrency: 5,
                },
                expect.any(Function),
            );
        } finally {
            await module.close();
        }
    });

    it('honors worker overrides and preserves explicit null dead-letter routing for redrive', async () => {
        const { module, feature, boss } = await setup([
            {
                name: 'email-source',
                transactional: false,
                consume: vi.fn(),
                workerOptions: { localConcurrency: 2, pollingIntervalSeconds: 2 },
            },
            {
                name: JOB_QUEUE_DEAD_LETTER_REDRIVE,
                transactional: false,
                consume: vi.fn(),
                queueOptions: JOB_QUEUE_DEAD_LETTER_REDRIVE_OPTIONS,
                workerOptions: { localConcurrency: 1, pollingIntervalSeconds: 2 },
            },
        ]);
        try {
            await feature.onApplicationBootstrap();
            expect(boss.work).toHaveBeenCalledWith(
                'email-source',
                {
                    batchSize: 1,
                    pollingIntervalSeconds: 2,
                    localConcurrency: 2,
                },
                expect.any(Function),
            );
            expect(boss.work).toHaveBeenCalledWith(
                JOB_QUEUE_DEAD_LETTER_REDRIVE,
                {
                    batchSize: 1,
                    pollingIntervalSeconds: 2,
                    localConcurrency: 1,
                },
                expect.any(Function),
            );
            expect(boss.createQueue).toHaveBeenCalledWith(JOB_QUEUE_DEAD_LETTER_REDRIVE, {
                retryLimit: 10,
                retryDelay: 15,
                retryBackoff: true,
                policy: 'exclusive',
                partition: false,
            });
            expect(boss.updateQueue).not.toHaveBeenCalledWith(JOB_QUEUE_DEAD_LETTER_REDRIVE, expect.anything());
        } finally {
            await module.close();
        }
    });

    it('rejects a worker for the shared dead-letter storage queue', async () => {
        const { module, feature, boss } = await setup([
            { name: JOB_QUEUE_DEAD_LETTER, transactional: false, consume: vi.fn() },
        ]);
        try {
            await expect(feature.onApplicationBootstrap()).rejects.toThrow('cannot register a worker');
            expect(boss.createQueue).not.toHaveBeenCalled();
            expect(boss.work).not.toHaveBeenCalled();
        } finally {
            await module.close();
        }
    });
});
