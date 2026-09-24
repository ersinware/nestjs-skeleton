/**
 * @file error-reporter.adapter.ts
 * @description Combines error logging and exception tracking at handling boundaries.
 */

import { Inject, Injectable } from '@nestjs/common';
import type {
    ErrorReportContext,
    IErrorReporterPort,
} from 'src/core/observability/error-reporter/port/error-reporter.port';
import { TOKEN_EXCEPTION_TRACKER_PORT, type IExceptionTrackerPort } from 'src/core/observability/exception-tracker';
import { TOKEN_LOGGER_PORT, type ILoggerPort } from 'src/core/observability/logger';
import { toError } from 'src/shared/exception';

/**
 * Keeps the two reporting destinations paired without owning failure policy.
 */
@Injectable()
export class ErrorReporterAdapter implements IErrorReporterPort {
    /**
     * @param loggerPort Records operational error diagnostics
     * @param exceptionTrackerPort Captures the original failure for investigation
     */
    constructor(
        @Inject(TOKEN_LOGGER_PORT) private readonly loggerPort: ILoggerPort,
        @Inject(TOKEN_EXCEPTION_TRACKER_PORT) private readonly exceptionTrackerPort: IExceptionTrackerPort,
    ) {}

    /**
     * Normalizes only the log representation, preserving the original value for the tracker.
     *
     * @param error The original caught value
     * @param context The handling boundary's reporting metadata
     */
    report(error: unknown, context: ErrorReportContext) {
        const _error = toError(error);

        this.loggerPort.error({
            class: context.class,
            method: context.method,
            message: context.message || _error.message,
            error: _error,
            ...(context.data && { data: context.data }),
        });
        this.exceptionTrackerPort.captureException(error);
    }
}
