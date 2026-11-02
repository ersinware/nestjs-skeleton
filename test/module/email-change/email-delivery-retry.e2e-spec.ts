/**
 * @file email-delivery-retry.e2e-spec.ts
 * @description Verifies email provider identity and settlement through production consumers and real pg-boss storage.
 */

import { ConfigService } from '@nestjs/config';
import { ModulesContainer } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { TOKEN_EMAILER_PORT, type IEmailerPort } from 'src/core/email';
import { EmailerAdapter } from 'src/core/email/adapter/emailer.adapter';
import { JOB_QUEUE_DEAD_LETTER, type IJobConsumer, type Job } from 'src/core/job-queue';
import { JobQueueDatabaseAdapter } from 'src/core/job-queue/adapter/job-queue-database.adapter';
import { TOKEN_JOB_QUEUE_CLIENT } from 'src/core/job-queue/job-queue-client.token';
import { JobQueueFeatureModule, TOKEN_FEATURE_CONSUMERS } from 'src/core/job-queue/job-queue-feature.module';
import { AdminRefreshReuseNoticeConsumer } from 'src/module/admin/application/consumer/admin-refresh-reuse-notice.consumer';
import { UserRefreshReuseNoticeConsumer } from 'src/module/user/application/consumer/user-refresh-reuse-notice.consumer';
import { createTestApp } from 'test/shared/test-app.factory';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

describe.each([AdminRefreshReuseNoticeConsumer, UserRefreshReuseNoticeConsumer])(
    '%s email retry safety',
    (Consumer) => {
        let app: NestFastifyApplication;
        let boss: PgBoss;
        let adapter: JobQueueDatabaseAdapter;
        let queue: string;
        const aggregateId = randomUUID();
        const requests: { key: string; body: string }[] = [];
        const providerCache = new Map<string, { body: string; acceptedAt: number }>();
        const physicalSend = vi.fn();
        let providerTime = 0;
        let concurrentOnce = false;
        const retention = 24 * 60 * 60 * 1000;

        beforeAll(async () => {
            const emailer = new EmailerAdapter(
                new ConfigService({ EMAIL_API_KEY: 're_test', EMAIL_FROM_ADDRESS: 'sender@example.test' }),
            );
            const port: IEmailerPort = { sendEmail: (data, delivery) => emailer.sendEmail(data, delivery) };
            app = await createTestApp({ overrides: [{ provide: TOKEN_EMAILER_PORT, useValue: port }] });
            boss = app.get(TOKEN_JOB_QUEUE_CLIENT);
            adapter = app.get(JobQueueDatabaseAdapter);
            for (const existing of await boss.getQueues()) {
                await boss.offWork(existing.name, { wait: true });
            }
            const consumer = app.get(Consumer);
            queue = consumer.name;
            await new JobQueueFeatureModule(boss, adapter, { report: vi.fn() }, [consumer]).onApplicationBootstrap();
        }, 30_000);

        beforeEach(() => {
            requests.length = 0;
            providerCache.clear();
            providerTime = 0;
            concurrentOnce = false;
            vi.spyOn(console, 'error').mockImplementation(() => {});
            // Model only the provider boundary; SDK serialization, application handlers, and queue settlement remain real.
            vi.stubGlobal(
                'fetch',
                vi.fn<typeof fetch>((url, options) =>
                    Promise.resolve().then(() => {
                        expect(url).toBe('https://api.resend.com/emails');
                        const key = new Headers(options?.headers).get('Idempotency-Key')!;
                        const body = options?.body as string;
                        requests.push({ key, body });
                        if (concurrentOnce) {
                            concurrentOnce = false;
                            return new Response(
                                JSON.stringify({
                                    name: 'concurrent_idempotent_requests',
                                    statusCode: 409,
                                    message: 'In progress',
                                }),
                                { status: 409 },
                            );
                        }
                        const previous = providerCache.get(key);
                        if (previous && providerTime - previous.acceptedAt < retention) {
                            return previous.body === body
                                ? new Response(JSON.stringify({ id: 'deduplicated' }), { status: 200 })
                                : new Response(
                                      JSON.stringify({
                                          name: 'invalid_idempotent_request',
                                          statusCode: 409,
                                          message: 'Payload changed',
                                      }),
                                      { status: 409 },
                                  );
                        }
                        providerCache.set(key, { body, acceptedAt: providerTime });
                        physicalSend(key);
                        return new Response(JSON.stringify({ id: randomUUID() }), { status: 200 });
                    }),
                ),
            );
        });

        afterEach(async () => {
            for (const name of [queue, JOB_QUEUE_DEAD_LETTER]) {
                const owned = await boss.findJobs<Job>(name, { data: { aggregateId } });
                if (owned.length) {
                    await boss.deleteJob(
                        name,
                        owned.map((job) => job.id),
                    );
                }
            }
            vi.unstubAllGlobals();
        });

        afterAll(async () => {
            await app?.close();
        });

        /**
         * Creates durable event-time recipient facts.
         *
         * @param deliveryId Optional identity for duplicate or changed-payload attempts
         * @returns Logical delivery independent of the physical pg-boss ID
         */
        function delivery(deliveryId = randomUUID()): Job {
            return {
                aggregateId,
                deliveryId,
                payload: { recipientEmail: 'original@example.test', recipientName: 'Original <Name>' },
            };
        }

        /**
         * Waits for settlement of a physical job.
         *
         * @param id Physical queue row ID
         * @param state Expected persisted lifecycle state
         */
        async function settled(id: string, state: string) {
            await expect
                .poll(async () => (await boss.findJobs(queue, { id }))[0]?.state, { timeout: 5_000, interval: 25 })
                .toBe(state);
        }

        /**
         * Wakes an existing production worker after explicit test redrive/retry operations.
         */
        function wake() {
            for (const worker of boss.getWipData().filter((worker) => worker.name === queue)) {
                boss.notifyWorker(worker.id);
            }
        }

        it('keeps every application worker notify-enabled and every transactional batch at one', async () => {
            const consumers = [...app.get(ModulesContainer).values()].flatMap(
                (module) =>
                    (module.providers.get(TOKEN_FEATURE_CONSUMERS)?.instance as IJobConsumer[] | undefined) ?? [],
            );
            expect(consumers).toHaveLength(20);
            const transactional = consumers.filter((consumer) => consumer.transactional);
            expect(transactional).toHaveLength(4);
            expect(transactional.every((consumer) => consumer.workerOptions.batchSize === 1)).toBe(true);
            const persisted = await boss.getQueues();
            for (const consumer of consumers) {
                expect(persisted.find((existing) => existing.name === consumer.name)?.notify).toBe(true);
            }
            expect(persisted.find((existing) => existing.name === JOB_QUEUE_DEAD_LETTER)?.notify).toBe(false);
        });

        it('deduplicates repeated delivery and uses a new key for a new logical email', async () => {
            const data = delivery();
            const first = await boss.send(queue, data);
            await settled(first!, 'completed');
            const duplicate = await boss.send(queue, data);
            await settled(duplicate!, 'completed');
            const next = delivery();
            expect(next.deliveryId).not.toBe(data.deliveryId);
            const nextId = await boss.send(queue, next);
            await settled(nextId!, 'completed');
            expect(requests.map((request) => request.key)).toEqual([
                `${queue}/${data.deliveryId}`,
                `${queue}/${data.deliveryId}`,
                `${queue}/${next.deliveryId}`,
            ]);
            expect(requests[0]!.body).toBe(requests[1]!.body);
            expect(physicalSend).toHaveBeenCalledTimes(2);
        });

        it('routes changed payload to the DLQ immediately with no new provider identity', async () => {
            const data = delivery();
            await settled((await boss.send(queue, data))!, 'completed');
            const changed = { ...data, payload: { ...data.payload, recipientName: 'Changed' } };
            const conflictId = await boss.send(queue, changed);
            await settled(conflictId!, 'failed');
            const row = (await boss.findJobs(queue, { id: conflictId! }))[0]!;
            expect(row.retryCount).toBe(0);
            const copies = await boss.findJobs<Job>(JOB_QUEUE_DEAD_LETTER, { data: { aggregateId } });
            expect(copies).toHaveLength(1);
            expect(copies[0]).toMatchObject({ sourceId: conflictId, sourceName: queue, data: changed });
            expect(requests.map((request) => request.key)).toEqual([
                `${queue}/${data.deliveryId}`,
                `${queue}/${data.deliveryId}`,
            ]);
            expect(physicalSend).toHaveBeenCalledTimes(1);
        });

        it('retries concurrent idempotency conflict with the original identity', async () => {
            concurrentOnce = true;
            const data = delivery();
            const id = await boss.send(queue, data, { retryDelay: 0, retryBackoff: false });
            await settled(id!, 'retry');
            expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { data: { aggregateId } })).toEqual([]);
            wake();
            await settled(id!, 'completed');
            expect(requests.map((request) => request.key)).toEqual([
                `${queue}/${data.deliveryId}`,
                `${queue}/${data.deliveryId}`,
            ]);
            expect(physicalSend).toHaveBeenCalledTimes(1);
        });

        it('repeats an accepted external effect after completion failure without a second physical send', async () => {
            const data = delivery();
            const execute = adapter.executeSql.bind(adapter);
            let rejectedCompletion = false;
            vi.spyOn(adapter, 'executeSql').mockImplementation((text, values) => {
                if (!rejectedCompletion && values?.[0] === queue && text.includes("state = 'completed'")) {
                    rejectedCompletion = true;
                    return Promise.reject(new Error('Injected completion failure after accepted email'));
                }
                return execute(text, values);
            });
            const id = await boss.send(queue, data, { retryDelay: 0, retryBackoff: false });
            await settled(id!, 'retry');
            expect(rejectedCompletion).toBe(true);
            expect(physicalSend).toHaveBeenCalledTimes(1);
            wake();
            await settled(id!, 'completed');
            expect(requests).toHaveLength(2);
            expect(requests[0]).toEqual(requests[1]);
            expect(physicalSend).toHaveBeenCalledTimes(1);
        });

        it('preserves logical identity through exhausted completion, DLQ, worker restart, and delayed redrive', async () => {
            const data = delivery();
            const execute = adapter.executeSql.bind(adapter);
            const fault = vi.spyOn(adapter, 'executeSql').mockImplementation((text, values) => {
                if (values?.[0] === queue && text.includes("state = 'completed'")) {
                    return Promise.reject(new Error('Injected lost settlement'));
                }
                return execute(text, values);
            });
            const id = await boss.send(queue, data, { retryLimit: 0 });
            await settled(id!, 'failed');
            fault.mockRestore();
            const dead = (await boss.findJobs<Job>(JOB_QUEUE_DEAD_LETTER, { data: { aggregateId } }))[0]!;
            expect(dead.data).toEqual(data);
            expect(dead.sourceId).toBe(id);
            expect(physicalSend).toHaveBeenCalledTimes(1);

            await boss.offWork(queue, { wait: true });
            // The selected application strategy permits redrive past provider retention; no ledger or deadline blocks it.
            providerTime = retention + 1;
            expect(await boss.redrive(JOB_QUEUE_DEAD_LETTER, { limit: 1, sourceName: queue })).toBe(1);
            const redriven = (await boss.findJobs<Job>(queue, { data: { aggregateId }, queued: true }))[0]!;
            expect(redriven.id).not.toBe(id);
            expect(redriven.id).not.toBe(dead.id);
            expect(redriven.data).toEqual(data);
            const consumer = app.get(Consumer);
            await new JobQueueFeatureModule(boss, adapter, { report: vi.fn() }, [consumer]).onApplicationBootstrap();
            wake();
            await settled(redriven.id, 'completed');
            expect(requests).toHaveLength(2);
            expect(requests[0]).toEqual(requests[1]);
            expect(physicalSend).toHaveBeenCalledTimes(2);
            expect(await boss.findJobs(JOB_QUEUE_DEAD_LETTER, { data: { aggregateId } })).toEqual([]);
        });
    },
);
