/**
 * @file tracker.module.ts
 * @description Module that provides monitoring utilities (like exception tracking).
 */

import { Module } from '@nestjs/common';
import { ExceptionTrackerAdapter } from 'src/core/observability/tracker/adapter';
import { TOKEN_EXCEPTION_TRACKER_PORT } from 'src/core/observability/tracker/port';

/**
 * Provides the exception tracker port backed by the Sentry adapter.
 */
@Module({
    providers: [
        {
            provide: TOKEN_EXCEPTION_TRACKER_PORT,
            useClass: ExceptionTrackerAdapter,
        },
    ],
    exports: [TOKEN_EXCEPTION_TRACKER_PORT],
})
export class TrackerModule {}
