/**
 * @file sentry.adapter.ts
 * @description Sentry implementation of the exception tracker port.
 */

import { Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { IExceptionTrackerPort } from 'src/core/observability/tracker/port';

/**
 * Adapter that uses @sentry/nestjs to capture exceptions and forward them to Sentry.
 */
@Injectable()
export class ExceptionTrackerAdapter implements IExceptionTrackerPort {
    /**
     * Captures an exception and sends it to Sentry.
     *
     * @param exception The exception or error to track.
     */
    captureException(exception: unknown): void {
        Sentry.captureException(exception);
    }
}
