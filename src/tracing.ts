/**
 * @file tracing.ts
 * @description OpenTelemetry initialization. Must be imported at the very top of main.ts
 * to auto-instrument the Node.js process before any other modules load.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Environment } from 'src/common/enum/config/environment.enum';
import { ENV } from 'src/common/config/constant/env.constant';

import { HostMetrics } from '@opentelemetry/host-metrics';
import { metrics } from '@opentelemetry/api';

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

    function handleShutdown() {
        otelSDK!
            .shutdown()
            .catch((error) => console.log('Error shutting down OpenTelemetry SDK', error))
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
