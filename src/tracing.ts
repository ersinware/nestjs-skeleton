/**
 * @file tracing.ts
 * @description Initializes the OpenTelemetry SDK (traces, metrics, host metrics). Imported at the top of `main.ts`, before the modules its auto-instrumentation patches at require-time.
 */

import { FastifyOtelInstrumentation } from '@fastify/otel';
import { metrics } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HostMetrics } from '@opentelemetry/host-metrics';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { SentryContextManager } from '@sentry/nestjs';
import { ENV, Environment, RUNTIME_FLAG } from 'src/core/config';

if (
    process.env[ENV.OTEL_SDK_DISABLED] !== 'true' &&
    process.env[ENV.NODE_ENV] !== Environment.TEST &&
    !process.env[RUNTIME_FLAG.VITEST] &&
    process.env[RUNTIME_FLAG.CI] !== 'true'
) {
    // OTEL_NODE_RESOURCE_DETECTORS includes serviceinstance last: a fresh UUID distinguishes
    // each process lifetime without losing environment, host, or process attributes.
    // Without sampler env overrides, the SDK defaults to parentbased_always_on:
    // retain all root traces for Collector tail sampling and honor parent decisions.
    const otelSDK = new NodeSDK({
        // Sentry's AsyncLocalStorage manager, so each request's Sentry scope (request data on a
        // captured exception) follows the OTel context that this SDK owns (`instrument.ts`).
        contextManager: new SentryContextManager(),
        traceExporter: new OTLPTraceExporter(),
        metricReader: new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter(),
            exportIntervalMillis: 15000,
        }),
        instrumentations: [
            // Fastify's own instrumentation: names the request span after the matched route and sets
            // `http.route`, which the generic HTTP instrumentation cannot know. Hook spans stay off —
            // one per lifecycle hook would bury the trace; the route-handler span it always emits is
            // the price of the route name.
            new FastifyOtelInstrumentation({ registerOnInitialization: true, instrumentHooks: false }),
            getNodeAutoInstrumentations({
                // fs, net and dns produce a span per syscall/lookup: noise with no decision behind it.
                '@opentelemetry/instrumentation-fs': { enabled: false },
                '@opentelemetry/instrumentation-net': { enabled: false },
                '@opentelemetry/instrumentation-dns': { enabled: false },
                // Idle pg-boss polling has no parent span; keep PostgreSQL spans inside request and
                // use-case traces without creating standalone traces for every pool checkout.
                '@opentelemetry/instrumentation-pg': { requireParentSpan: true },
                '@opentelemetry/instrumentation-pino': {
                    logKeys: {
                        traceId: 'traceId',
                        spanId: 'spanId',
                        traceFlags: 'traceFlags',
                    },
                },
            }),
        ],
    });

    /**
     * Flushes unsent telemetry on a termination signal. Flush-only by design: process termination
     * belongs to Nest's shutdown hooks, and exiting here would cut that cleanup mid-flight.
     */
    function handleShutdown() {
        // console over a logger: runs outside (and possibly after) the DI container's lifetime.
        otelSDK.shutdown().catch((error) => console.error('Error shutting down OpenTelemetry SDK', error));
    }

    // `once`, not `on`: Nest's shutdown hooks re-raise the signal after cleanup so the process
    // terminates with the default behavior — a persistent listener here would swallow that second
    // signal and keep the process alive forever.
    process.once('SIGTERM', handleShutdown);
    process.once('SIGINT', handleShutdown);

    otelSDK.start();

    new HostMetrics({
        meterProvider: metrics.getMeterProvider(),
        name: 'nestjs-host-metrics',
    }).start();
}
