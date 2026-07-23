/**
 * @file tracing.ts
 * @description Responsible for initializing the OpenTelemetry (OTel) tracing system. It is loaded before all other modules as the Node.js process starts, enabling the collection of application performance metrics and distributed tracing data. It must be imported at the very top of `main.ts`.
 */

import { metrics } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HostMetrics } from '@opentelemetry/host-metrics';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ENV, Environment } from 'src/core/config';

let otelSDK: NodeSDK | undefined;

if (process.env[ENV.NODE_ENV] !== Environment.TEST && !process.env['VITEST'] && process.env['CI'] !== 'true') {
    otelSDK = new NodeSDK({
        traceExporter: new OTLPTraceExporter(),
        metricReader: new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter(),
            exportIntervalMillis: 15000,
        }),
        instrumentations: [
            getNodeAutoInstrumentations({
                // Disable fs and net tracing as they generate too much noise usually
                '@opentelemetry/instrumentation-fs': { enabled: false },
                '@opentelemetry/instrumentation-net': { enabled: false },
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
     * Gracefully shuts down the OpenTelemetry SDK when the application is closing.
     * Performs memory cleanup before terminating the process to prevent the loss of unsent tracing or metric data.
     */
    function handleShutdown() {
        otelSDK!
            .shutdown()
            .catch((error) => console.error('Error shutting down OpenTelemetry SDK', error))
            .finally(() => process.exit(0));
    }

    process.on('SIGTERM', handleShutdown);
    process.on('SIGINT', handleShutdown);

    otelSDK.start();

    const hostMetrics = new HostMetrics({
        meterProvider: metrics.getMeterProvider(),
        name: 'nestjs-host-metrics',
    });
    hostMetrics.start();
}
