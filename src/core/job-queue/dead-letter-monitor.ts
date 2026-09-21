/**
 * @file dead-letter-monitor.ts
 * @description Samples pg-boss dead-letter state for low-cardinality OpenTelemetry gauges.
 */

import { Inject, Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { metrics, type BatchObservableCallback, type Meter, type ObservableGauge } from '@opentelemetry/api';
import { ENV } from 'src/core/config';
import {
    TOKEN_JOB_QUEUE_DEAD_LETTER_METRICS_PORT,
    type IJobQueueDeadLetterMetricsPort,
} from 'src/core/job-queue/port/job-queue-dead-letter-metrics.port';
import { TOKEN_ERROR_REPORTER_PORT, type IErrorReporterPort } from 'src/core/observability/error-reporter';
import { TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { DependencyUnavailableException } from 'src/shared/exception';

/**
 * Last fully successful business sample; failures never replace it with partial results.
 */
type DeadLetterSample = {
    /**
     * Ready dead-letter copies in the last complete sample.
     */
    readonly readyCount: number;

    /**
     * Age in seconds of the oldest retained dead-letter copy, or zero when none exists.
     */
    readonly oldestAgeSeconds: number;

    /**
     * Terminally failed redrive orchestration jobs in the last complete sample.
     */
    readonly redriveFailedCount: number;
};

/**
 * Resources allocated only on the instance assigned to monitoring.
 */
type DeadLetterMonitoring = {
    /**
     * Configured delay between completed samples, converted for Node timers.
     */
    readonly sampleIntervalMs: number;

    /**
     * Meter that owns the dead-letter instruments.
     */
    readonly meter: Meter;

    /**
     * Gauges registered together for cached observations.
     */
    readonly instruments: ObservableGauge[];

    /**
     * Exposes cached values without database I/O during collection.
     */
    readonly observe: BatchObservableCallback;
};

/**
 * Keeps database sampling outside OpenTelemetry collection and reports monitor failures.
 */
@Injectable()
export class DeadLetterMonitor implements OnApplicationBootstrap, OnModuleDestroy {
    /**
     * Absent when monitoring is disabled, so no telemetry resources are allocated.
     */
    private readonly monitoring: DeadLetterMonitoring | null = null;

    /**
     * The last complete sample, absent until the first successful read.
     */
    private sample: DeadLetterSample | null = null;

    /**
     * Monitoring state is independent of the last valid business sample.
     */
    private monitorUp = false;

    /**
     * Suppresses repeated diagnostics until a successful sample restores monitoring.
     */
    private failureReported = false;

    /**
     * Timer for the next sample, cancelled before queue/database shutdown.
     */
    private timer: NodeJS.Timeout | undefined;

    /**
     * Current sample awaited during shutdown.
     */
    private inFlight: Promise<void> | undefined;

    /**
     * Prevents a finishing sample from scheduling another after shutdown.
     */
    private stopped = false;

    /**
     * Initializes the sampler with the existing queue metrics and error-reporting ports.
     *
     * @param configService Supplies monitoring enablement and interval
     * @param metricsPort Reads pg-boss statistics and oldest creation time
     * @param errorReporterPort Reports monitoring failures
     * @param loggerPort Records dependency outage and recovery transitions
     */
    constructor(
        configService: ConfigService,
        @Inject(TOKEN_JOB_QUEUE_DEAD_LETTER_METRICS_PORT)
        private readonly metricsPort: IJobQueueDeadLetterMetricsPort,
        @Inject(TOKEN_ERROR_REPORTER_PORT) private readonly errorReporterPort: IErrorReporterPort,
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
    ) {
        if (!configService.getOrThrow<boolean>(ENV.JOB_QUEUE_DLQ_MONITOR_ENABLED)) {
            return;
        }

        const meter = metrics.getMeter('job-queue'),
            readyCountGauge = meter.createObservableGauge('job_queue_dlq_ready_count'),
            oldestAgeGauge = meter.createObservableGauge('job_queue_dlq_oldest_age_seconds'),
            monitorUpGauge = meter.createObservableGauge('job_queue_dlq_monitor_up'),
            redriveFailedGauge = meter.createObservableGauge('job_queue_redrive_failed_count');

        this.monitoring = {
            sampleIntervalMs: configService.getOrThrow<number>(ENV.JOB_QUEUE_DLQ_SAMPLE_INTERVAL) * 1000,
            meter,
            instruments: [readyCountGauge, oldestAgeGauge, monitorUpGauge, redriveFailedGauge],
            observe: (result) => {
                result.observe(monitorUpGauge, this.monitorUp ? 1 : 0);

                if (this.sample !== null) {
                    result.observe(readyCountGauge, this.sample.readyCount);
                    result.observe(oldestAgeGauge, this.sample.oldestAgeSeconds);
                    result.observe(redriveFailedGauge, this.sample.redriveFailedCount);
                }
            },
        };
    }

    /**
     * Registers gauges and samples immediately before scheduling periodic reads.
     */
    async onApplicationBootstrap(): Promise<void> {
        if (this.monitoring === null) {
            return;
        }

        this.monitoring.meter.addBatchObservableCallback(this.monitoring.observe, this.monitoring.instruments);

        await this.refresh();

        this.schedule();
    }

    /**
     * Stops sampling and unregisters callbacks before database pools close.
     */
    async onModuleDestroy(): Promise<void> {
        if (this.monitoring === null) {
            return;
        }

        this.stopped = true;

        if (this.timer !== undefined) {
            clearTimeout(this.timer);
        }

        this.monitoring.meter.removeBatchObservableCallback(this.monitoring.observe, this.monitoring.instruments);
        await this.inFlight;
    }

    /**
     * Reads one complete sample and preserves previous values on any failure.
     */
    private async refresh(): Promise<void> {
        let nextSample: DeadLetterSample;

        try {
            nextSample = await this.readSample();
        } catch (error) {
            this.monitorUp = false;
            this.reportFailure(error);

            return;
        }

        this.sample = nextSample;
        this.monitorUp = true;
        this.reportRecovery();
    }

    /**
     * Builds a complete snapshot before replacing the last successful one.
     *
     * @returns Current dead-letter counts and oldest age
     */
    private async readSample(): Promise<DeadLetterSample> {
        const [readyCount, oldest, redriveFailedCount] = await Promise.all([
            this.metricsPort.getDeadLetterReadyCount(),
            this.metricsPort.getOldestDeadLetterCreatedOn(),
            this.metricsPort.getDeadLetterRedriveFailedCount(),
        ]);

        return {
            readyCount,
            oldestAgeSeconds: oldest === null ? 0 : Math.max(0, (Date.now() - oldest.getTime()) / 1000),
            redriveFailedCount,
        };
    }

    /**
     * Reports the first failed sample and retries reporting if its destination fails.
     *
     * @param error Sampling failure
     */
    private reportFailure(error: unknown): void {
        if (this.failureReported) {
            return;
        }

        try {
            if (error instanceof DependencyUnavailableException) {
                this.loggerPort.warn({
                    class: this.constructor.name,
                    method: this.refresh.name,
                    message: 'Dead-letter monitoring unavailable.',
                    error,
                });
            } else {
                this.errorReporterPort.report(error, {
                    class: this.constructor.name,
                    method: this.refresh.name,
                });
            }

            this.failureReported = true;
        } catch {
            // A reporting failure must not change the sampled health or block the next attempt.
        }
    }

    /**
     * Reports recovery without allowing logging failures to invalidate a successful sample.
     */
    private reportRecovery(): void {
        if (!this.failureReported) {
            return;
        }

        this.failureReported = false;

        try {
            this.loggerPort.info({
                class: this.constructor.name,
                method: this.refresh.name,
                message: 'Dead-letter monitoring restored.',
            });
        } catch {
            // Logging failure must not mask recovery or suppress a later outage.
        }
    }

    /**
     * Schedules the next read only after the current one settles.
     */
    private schedule(): void {
        if (this.stopped || this.monitoring === null) {
            return;
        }

        this.timer = setTimeout(() => {
            this.inFlight = this.refresh();

            void this.inFlight.then(() => {
                this.inFlight = undefined;
                this.schedule();
            });
        }, this.monitoring.sampleIntervalMs);

        this.timer.unref();
    }
}
