/**
 * @file notification-dispatch.e2e-spec.ts
 * @description Exercises production listener transport, polling recovery, and competing PostgreSQL claims.
 */

import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { ENV, resolveEnvFilePath, validateConfig } from 'src/core/config';
import { createDatabasePool } from 'src/core/database';
import { JobQueueDatabaseAdapter } from 'src/core/job-queue/adapter/job-queue-database.adapter';
import type { ILoggerPort } from 'src/core/observability/logger';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

describe('PostgreSQL notification dispatch', { timeout: 15_000 }, () => {
    let module: TestingModule;
    let config: ConfigService;
    const nodes: { boss: PgBoss; adapter: JobQueueDatabaseAdapter; pool: Pool }[] = [];
    const queues = new Set<string>();
    const logger = { warn: vi.fn(), info: vi.fn() } as unknown as ILoggerPort;

    beforeAll(async () => {
        module = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({
                    isGlobal: true,
                    envFilePath: resolveEnvFilePath(),
                    validate: validateConfig,
                }),
            ],
        }).compile();
        config = module.get(ConfigService);
    });

    afterEach(async () => {
        for (const node of nodes) {
            await node.boss.stop({ graceful: true });
        }
        const first = nodes[0];
        if (first) {
            for (const queue of queues) {
                await first.boss.deleteQueue(queue);
            }
        }
        for (const node of nodes) {
            await node.adapter.close();
        }
        nodes.length = 0;
        queues.clear();
    });

    afterAll(async () => {
        await module?.close();
    });

    /**
     * Starts an independent node using the production database adapter.
     *
     * @param unavailable Whether initial LISTEN must fail while normal SQL remains available
     * @returns Node resources and listener fault boundary
     */
    async function startNode(unavailable = false) {
        const pool = createDatabasePool(config, config.getOrThrow<string>(ENV.DATABASE_URL), 5);
        const adapter = new JobQueueDatabaseAdapter(pool, logger);
        const listen = adapter.listen.bind(adapter);
        const notifications = vi.fn<(queue: string) => void>();
        let dropNotifications = false;
        let dropRecoveryWakeUps = false;
        const listenSpy = vi.spyOn(adapter, 'listen').mockImplementation(async (channel, notify, reconnect) => {
            if (unavailable) {
                // A real driver-level LISTEN failure, without disabling pooled SQL or the worker.
                return listen('invalid-channel-name', notify, reconnect);
            }
            return listen(
                channel,
                (queue) => {
                    notifications(queue);
                    if (!dropNotifications) {
                        notify(queue);
                    }
                },
                () => {
                    if (!dropRecoveryWakeUps) {
                        reconnect();
                    }
                },
            );
        });
        const boss = new PgBoss({ db: adapter, schedule: false, useListenNotify: true });
        boss.on('error', () => {});
        await boss.start();
        const node = { boss, pool, adapter };
        nodes.push(node);
        return {
            ...node,
            listenSpy,
            notifications,
            dropNotifications: () => {
                dropNotifications = true;
            },
            dropRecoveryWakeUps: () => {
                dropRecoveryWakeUps = true;
            },
        };
    }

    /**
     * Creates a test-owned immediately runnable notification queue.
     *
     * @param boss Node provisioning the queue
     * @returns Queue identity
     */
    async function createQueue(boss: PgBoss): Promise<string> {
        const queue = `test.notify.${randomUUID()}`;
        queues.add(queue);
        await boss.createQueue(queue, { notify: true });
        return queue;
    }

    /**
     * Waits for an idle fetch so notification assertions cannot pass on the initial fetch.
     *
     * @param boss Worker node
     * @param queue Owning queue
     */
    async function waitForIdleFetch(boss: PgBoss, queue: string) {
        await expect
            .poll(() => boss.getWipData().find((worker) => worker.name === queue)?.lastFetchedOn, {
                timeout: 2_000,
                interval: 20,
            })
            .toBeTypeOf('number');
        expect(boss.getWipData().find((worker) => worker.name === queue)).toBeDefined();
    }

    it('wakes an idle worker immediately instead of waiting for a long backstop', async () => {
        const node = await startNode();
        const queue = await createQueue(node.boss);
        const received = vi.fn();
        await node.boss.work(queue, { notifyPollingIntervalSeconds: 30 }, (jobs) => {
            received(jobs[0]?.id);
            return Promise.resolve();
        });
        await waitForIdleFetch(node.boss, queue);
        const id = await node.boss.send(queue, {});
        await expect.poll(() => received.mock.calls, { timeout: 2_000, interval: 20 }).toEqual([[id]]);
    });

    it('recovers a missed notification through healthy-listener safety-net polling', async () => {
        const node = await startNode();
        const queue = await createQueue(node.boss);
        const received = vi.fn();
        await node.boss.work(queue, { notifyPollingIntervalSeconds: 2 }, () => {
            received();
            return Promise.resolve();
        });
        await waitForIdleFetch(node.boss, queue);
        node.dropNotifications();
        await node.boss.send(queue, {});
        // No extra per-queue timer should bypass the configured backstop.
        await new Promise((resolve) => setTimeout(resolve, 750));
        expect(received).not.toHaveBeenCalled();
        await expect.poll(() => received.mock.calls.length, { timeout: 3_000, interval: 20 }).toBe(1);
    });

    it('uses notification backstop polling when LISTEN cannot be established', async () => {
        const node = await startNode(true);
        const queue = await createQueue(node.boss);
        const received = vi.fn();
        await node.boss.work(queue, { notifyPollingIntervalSeconds: 2 }, () => {
            received();
            return Promise.resolve();
        });
        await waitForIdleFetch(node.boss, queue);
        await node.boss.send(queue, {});
        await expect.poll(() => received.mock.calls.length, { timeout: 3_000, interval: 20 }).toBe(1);
    });

    it('uses backstop polling after listener loss and recovers its session', async () => {
        const node = await startNode();
        const queue = await createQueue(node.boss);
        const received = vi.fn();
        await node.boss.work(queue, { notifyPollingIntervalSeconds: 2 }, () => {
            received();
            return Promise.resolve();
        });
        await waitForIdleFetch(node.boss, queue);
        const channel = node.listenSpy.mock.calls[0]![0];
        const result = await node.pool.query<{ pid: number }>(
            'SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND query = $1 AND state = $2',
            [`LISTEN ${channel}`, 'idle'],
        );
        expect(result.rows).toHaveLength(1);
        node.dropRecoveryWakeUps();
        await node.pool.query('SELECT pg_terminate_backend($1)', [result.rows[0]!.pid]);
        await node.boss.send(queue, {});
        // Suppress reconnect hints so delivery must come from native backstop polling.
        await expect.poll(() => received.mock.calls.length, { timeout: 3_000, interval: 20 }).toBe(1);
        await expect
            .poll(
                async () =>
                    (
                        await node.pool.query(
                            'SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND query = $1 AND state = $2',
                            [`LISTEN ${channel}`, 'idle'],
                        )
                    ).rows.length,
                { timeout: 5_000, interval: 50 },
            )
            .toBe(1);
        await node.boss.send(queue, {});
        await expect.poll(() => received.mock.calls.length, { timeout: 1_000, interval: 20 }).toBe(2);
    });

    it('notifies two nodes but grants one successful claim', async () => {
        const first = await startNode();
        const second = await startNode();
        const queue = await createQueue(first.boss);
        const claims = vi.fn();
        for (const node of [first, second]) {
            await node.boss.work(queue, { notifyPollingIntervalSeconds: 30 }, (jobs) => {
                claims(jobs[0]?.id);
                return Promise.resolve();
            });
            await waitForIdleFetch(node.boss, queue);
        }
        const id = await first.boss.send(queue, {});
        for (const node of [first, second]) {
            await expect
                .poll(() => node.notifications.mock.calls.flat(), { timeout: 2_000, interval: 20 })
                .toContain(queue);
        }
        await expect
            .poll(async () => (await first.boss.findJobs(queue, { id: id! }))[0]?.state, {
                timeout: 2_000,
                interval: 20,
            })
            .toBe('completed');
        // Both listeners receive the same hint; additional hints cannot reclaim completed work.
        await first.pool.query('SELECT pg_notify($1, $2)', [first.listenSpy.mock.calls[0]![0], queue]);
        await expect
            .poll(() => second.boss.getWipData().find((w) => w.name === queue)?.lastFetchedOn, { timeout: 2_000 })
            .toBeTruthy();
        expect(claims).toHaveBeenCalledExactlyOnceWith(id);
    });
});
