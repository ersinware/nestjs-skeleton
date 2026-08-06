/**
 * @file exception-tracker.adapter.ts
 * @description Sentry implementation of the exception tracker port.
 */

import { Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { IExceptionTrackerPort } from 'src/core/observability/exception-tracker/port/exception-tracker.port';

/**
 * Forwards exceptions to Sentry.
 */
@Injectable()
export class ExceptionTrackerAdapter implements IExceptionTrackerPort {
    /**
     * Sends an exception to Sentry.
     *
     * @param exception The exception to report.
     */
    captureException(exception: unknown) {
        Sentry.captureException(exception);
    }
}
