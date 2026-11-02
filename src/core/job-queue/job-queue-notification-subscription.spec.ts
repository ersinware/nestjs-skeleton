/**
 * @file job-queue-notification-subscription.spec.ts
 * @description Verifies listener recovery and shutdown without live connections.
 */

import { EventEmitter } from 'node:events';
import type { Pool, PoolClient } from 'pg';
import { JobQueueNotificationSubscription } from 'src/core/job-queue/job-queue-notification-subscription';
import type { ILoggerPort } from 'src/core/observability/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Creates a controllable session at the pg driver boundary.
 *
 * @returns Session events and captured SQL/release calls
 */
function createClient() {
    return Object.assign(new EventEmitter(), {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        release: vi.fn(),
    });
}

describe('JobQueueNotificationSubscription', () => {
    let subscription: JobQueueNotificationSubscription | undefined;
    const warn = vi.fn();
    const info = vi.fn();
    const onNotification = vi.fn();
    const onReconnect = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(async () => {
        await subscription?.close();
        subscription = undefined;
        expect(vi.getTimerCount()).toBe(0);
        vi.useRealTimers();
    });

    /**
     * Opens the production subscription with a fake pool and observable callbacks.
     *
     * @param connect Controllable pool acquisition
     * @returns Subscription under test
     */
    async function open(connect: Pool['connect']): Promise<JobQueueNotificationSubscription> {
        subscription = await JobQueueNotificationSubscription.open({
            pool: { connect } as Pool,
            loggerPort: { warn, info } as unknown as ILoggerPort,
            channel: 'pgboss_test',
            onNotification,
            onReconnect,
        });
        return subscription;
    }

    it('pins one session, forwards payloads, and leaves healthy polling to pg-boss', async () => {
        const client = createClient();
        const connect = vi.fn().mockResolvedValue(client);
        const listener = await open(connect);
        client.emit('notification', { payload: 'critical' });
        client.emit('notification', {});
        await vi.advanceTimersByTimeAsync(10_000);

        expect(client.query).toHaveBeenCalledExactlyOnceWith('LISTEN pgboss_test');
        expect(connect).toHaveBeenCalledTimes(1);
        expect(onReconnect).toHaveBeenCalledTimes(1);
        expect(onNotification).toHaveBeenCalledExactlyOnceWith('critical');
        await listener.close();
        expect(client.release).toHaveBeenCalledTimes(1);
        expect(client.listenerCount('notification')).toBe(0);
    });

    it('reconnects after connection loss without generating queue wake-ups', async () => {
        const first = createClient();
        const recovered = createClient();
        const connect = vi
            .fn()
            .mockResolvedValueOnce(first)
            .mockRejectedValueOnce(new Error('still down'))
            .mockResolvedValue(recovered);
        await open(connect);
        first.emit('error', new Error('connection lost'));

        await vi.advanceTimersByTimeAsync(5_000);
        expect(onNotification).not.toHaveBeenCalled();
        expect(first.release).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(onReconnect).toHaveBeenCalledTimes(2);
        expect(info).toHaveBeenCalledTimes(1);
        const count = onNotification.mock.calls.length;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(onNotification).toHaveBeenCalledTimes(count);
    });

    it('returns an outage handle and recovers even when initial acquisition fails', async () => {
        const client = createClient();
        const connect = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(client);
        await open(connect);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(onNotification).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(client.query).toHaveBeenCalledExactlyOnceWith('LISTEN pgboss_test');
        expect(onReconnect).toHaveBeenCalledTimes(1);
        expect(info).toHaveBeenCalledTimes(1);
    });

    it('discards a failed LISTEN session and retries with bounded backoff', async () => {
        const client = createClient();
        client.query.mockRejectedValue(new Error('LISTEN unavailable'));
        const connect = vi.fn().mockResolvedValueOnce(client).mockRejectedValue(new Error('unavailable'));
        await open(connect);
        expect(client.release).toHaveBeenCalledTimes(1);
        expect(client.listenerCount('error')).toBe(0);
        await vi.advanceTimersByTimeAsync(2_000 + 4_000 + 8_000 + 16_000 + 30_000 + 30_000);
        expect(connect).toHaveBeenCalledTimes(7);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('recovers after end and makes close idempotent while disconnected', async () => {
        const client = createClient();
        const connect = vi.fn().mockResolvedValue(client);
        const listener = await open(connect);
        client.emit('end');
        await listener.close();
        await listener.close();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(connect).toHaveBeenCalledTimes(1);
        expect(client.release).toHaveBeenCalledTimes(1);
        expect(onNotification).not.toHaveBeenCalled();
    });

    it('releases an in-flight reconnect acquisition after shutdown without subscribing', async () => {
        const first = createClient();
        const late = createClient();
        let resolve!: (client: PoolClient) => void;
        const pending = new Promise<PoolClient>((done) => {
            resolve = done;
        });
        const connect = vi.fn().mockResolvedValueOnce(first).mockReturnValueOnce(pending);
        const listener = await open(connect);
        first.emit('end');
        await vi.advanceTimersByTimeAsync(2_000);
        await listener.close();
        resolve(late as unknown as PoolClient);
        await vi.advanceTimersByTimeAsync(0);
        expect(late.query).not.toHaveBeenCalled();
        expect(late.release).toHaveBeenCalledTimes(1);
        expect(onReconnect).toHaveBeenCalledTimes(1);
    });
});
