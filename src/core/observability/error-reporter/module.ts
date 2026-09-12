/**
 * @file module.ts
 * @description Wires the shared error reporter to logging and exception tracking.
 */

import { Module } from '@nestjs/common';
import { ErrorReporterAdapter } from 'src/core/observability/error-reporter/adapter/error-reporter.adapter';
import { TOKEN_ERROR_REPORTER_PORT } from 'src/core/observability/error-reporter/port/error-reporter.port';
import { ExceptionTrackerModule } from 'src/core/observability/exception-tracker';
import { LoggerModule } from 'src/core/observability/logger';

/** Exposes one reporting port to handling boundaries. */
@Module({
    imports: [LoggerModule, ExceptionTrackerModule],
    providers: [{ provide: TOKEN_ERROR_REPORTER_PORT, useClass: ErrorReporterAdapter }],
    exports: [TOKEN_ERROR_REPORTER_PORT],
})
export class ErrorReporterModule {}
