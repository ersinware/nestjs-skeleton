/**
 * @file tracker.module.ts
 * @description Global module that provides monitoring utilities (like exception tracking).
 */

import { Global, Module } from '@nestjs/common';
import { ExceptionTrackerAdapter } from 'src/core/observability/tracker/adapter';
import { TOKEN_EXCEPTION_TRACKER_PORT } from 'src/core/observability/tracker/port';

@Global()
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
