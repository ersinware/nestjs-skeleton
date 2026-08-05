/**
 * @file exception-tracker.adapter.ts
 * @description Sentry implementation of the exception tracker port.
 */

import { Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { IExceptionTrackerPort } from 'src/core/observability/exception-tracker/port/exception-tracker.port';

/**
 * Forwards captured exceptions to Sentry via `@sentry/nestjs`.
 */
@Injectable()
export class ExceptionTrackerAdapter implements IExceptionTrackerPort {
    /**
     * Captures an exception and sends it to Sentry.
     *
     * @param exception The exception or error to track.
     */
    captureException(exception: unknown) {
        Sentry.captureException(exception);
    }
}
