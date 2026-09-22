/**
 * @file dead-letter-monitor.spec.ts
 * @description Verifies opt-in DLQ monitoring, cached observations, and sampler lifecycle.
 */

import { ConfigService } from '@nestjs/config';
import { metrics } from '@opentelemetry/api';
import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { DeadLetterMonitor } from 'src/core/job-queue/dead-letter-monitor';
import { DependencyUnavailableException } from 'src/shared/exception';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Collects actual SDK observations without a periodic exporter or network access.
 */
class SnapshotReader extends MetricReader {
    /**
     * Nothing is buffered outside the SDK.
     */
    protected async onForceFlush(): Promise<void> {}

    /**
     * No external resources are owned by this reader.
     */
    protected async onShutdown(): Promise<void> {}
}

describe('DeadLetterMonitor', () => {
    let monitor: DeadLetterMonitor;
    let reader: SnapshotReader;
    let provider: MeterProvider;
    const port = {
        getDeadLetterReadyCount: vi.fn<() => Promise<number>>(),
        getDeadLetterRedriveFailedCount: vi.fn<() => Promise<number>>(),
        getOldestDeadLetterCreatedOn: vi.fn<() => Promise<Date | null>>(),
    };
    const reporter = { report: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    /**
     * Creates a monitor with explicitly assigned instance responsibility.
     *
     * @param enabled Whether this instance should monitor the shared DLQ
     * @returns The configured monitor
     */
    function createMonitor(enabled: boolean): DeadLetterMonitor {
        return new DeadLetterMonitor(
            new ConfigService({ JOB_QUEUE_DLQ_MONITOR_ENABLED: enabled, JOB_QUEUE_DLQ_SAMPLE_INTERVAL: 60 }),
            port,
            reporter,
            logger,
        );
    }

    /**
     * Reads the same observable instruments used by the periodic exporter.
     *
     * @returns Gauge names and their recorded values
     */
    async function observe(): Promise<Record<string, unknown>> {
        const { resourceMetrics, errors } = await reader.collect();
        expect(errors).toEqual([]);
        return Object.fromEntries(
            resourceMetrics.scopeMetrics.flatMap((scope) =>
                scope.metrics.flatMap((metric) =>
                    metric.dataPoints.map((point) => [metric.descriptor.name, 'value' in point ? point.value : null]),
                ),
            ),
        );
    }

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-21T00:00:00Z'));
        reader = new SnapshotReader();
        provider = new MeterProvider({ readers: [reader] });
        vi.spyOn(metrics, 'getMeter').mockReturnValue(provider.getMeter('monitor-test'));
        port.getDeadLetterReadyCount.mockResolvedValue(2);
        port.getDeadLetterRedriveFailedCount.mockResolvedValue(1);
        port.getOldestDeadLetterCreatedOn.mockResolvedValue(new Date('2026-09-20T23:59:00Z'));
    });

    afterEach(async () => {
        await monitor.onModuleDestroy();
        await provider.shutdown();
        vi.useRealTimers();
    });

    it('allocates no telemetry resources and performs no reads on a disabled instance', async () => {
        monitor = createMonitor(false);
        await monitor.onApplicationBootstrap();
        await vi.advanceTimersByTimeAsync(180_000);

        expect(vi.spyOn(metrics, 'getMeter')).not.toHaveBeenCalled();
        expect(await observe()).toEqual({});
        expect(port.getDeadLetterReadyCount).not.toHaveBeenCalled();
        expect(port.getDeadLetterRedriveFailedCount).not.toHaveBeenCalled();
        expect(port.getOldestDeadLetterCreatedOn).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('samples immediately and serves cached gauges without reading during collection', async () => {
        monitor = createMonitor(true);
        await monitor.onApplicationBootstrap();
        const snapshot = {
            job_queue_dlq_monitor_up: 1,
            job_queue_dlq_ready_count: 2,
            job_queue_dlq_oldest_age_seconds: 60,
            job_queue_redrive_failed_count: 1,
        };
        expect(await observe()).toEqual(snapshot);
        await vi.advanceTimersByTimeAsync(59_999);
        expect(await observe()).toEqual(snapshot);
        expect(port.getDeadLetterReadyCount).toHaveBeenCalledTimes(1);
        expect(port.getDeadLetterRedriveFailedCount).toHaveBeenCalledTimes(1);
        expect(port.getOldestDeadLetterCreatedOn).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        expect((await observe())['job_queue_dlq_oldest_age_seconds']).toBe(120);
        expect(port.getDeadLetterReadyCount).toHaveBeenCalledTimes(2);

        await monitor.onModuleDestroy();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(port.getDeadLetterReadyCount).toHaveBeenCalledTimes(2);
    });

    it('keeps the last complete sample during failures and recovers on the next successful sample', async () => {
        monitor = createMonitor(true);
        await monitor.onApplicationBootstrap();
        port.getDeadLetterReadyCount.mockRejectedValue(new DependencyUnavailableException());
        port.getDeadLetterRedriveFailedCount.mockResolvedValue(9);
        await vi.advanceTimersByTimeAsync(120_000);

        expect(await observe()).toEqual({
            job_queue_dlq_monitor_up: 0,
            job_queue_dlq_ready_count: 2,
            job_queue_dlq_oldest_age_seconds: 60,
            job_queue_redrive_failed_count: 1,
        });
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(reporter.report).not.toHaveBeenCalled();

        port.getDeadLetterReadyCount.mockResolvedValue(0);
        port.getOldestDeadLetterCreatedOn.mockResolvedValue(null);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(await observe()).toEqual({
            job_queue_dlq_monitor_up: 1,
            job_queue_dlq_ready_count: 0,
            job_queue_dlq_oldest_age_seconds: 0,
            job_queue_redrive_failed_count: 9,
        });
        expect(logger.info).toHaveBeenCalledTimes(1);
    });

    it('publishes only monitor health before the first successful sample and reports an unexpected outage once', async () => {
        const failure = new Error('Intentional sample failure.');
        port.getDeadLetterReadyCount.mockRejectedValue(failure);
        monitor = createMonitor(true);
        await monitor.onApplicationBootstrap();

        expect(await observe()).toEqual({ job_queue_dlq_monitor_up: 0 });
        expect(reporter.report).toHaveBeenCalledWith(failure, {
            class: 'DeadLetterMonitor',
            method: 'refresh',
        });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(reporter.report).toHaveBeenCalledTimes(1);

        port.getDeadLetterReadyCount.mockResolvedValue(2);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(await observe()).toEqual({
            job_queue_dlq_monitor_up: 1,
            job_queue_dlq_ready_count: 2,
            job_queue_dlq_oldest_age_seconds: 180,
            job_queue_redrive_failed_count: 1,
        });
        expect(logger.info).toHaveBeenCalledTimes(1);
    });
});
