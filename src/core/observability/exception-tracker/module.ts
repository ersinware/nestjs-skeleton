/**
 * @file module.ts
 * @description Wiring of the exception-tracker concern.
 */

import { Module } from '@nestjs/common';
import { ExceptionTrackerAdapter } from 'src/core/observability/exception-tracker/adapter/exception-tracker.adapter';
import { TOKEN_EXCEPTION_TRACKER_PORT } from 'src/core/observability/exception-tracker/port/exception-tracker.port';

/**
 * Binds the exception tracker port to its Sentry adapter.
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
export class ExceptionTrackerModule {}
