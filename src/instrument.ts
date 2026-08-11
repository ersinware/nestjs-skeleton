/**
 * @file instrument.ts
 * @description Initializes the Sentry SDK. Imported at the top of `main.ts`, before any other module loads, so its error hooks exist ahead of all application code.
 */

import * as Sentry from '@sentry/nestjs';
import { ENV } from 'src/core/config';
import { ExceptionTrackerEnvironment } from 'src/core/observability/exception-tracker';

const SENTRY_DSN = process.env[ENV.SENTRY_DSN],
    SENTRY_ENVIRONMENT = process.env[ENV.SENTRY_ENVIRONMENT];

// Interpret-only, fail safe: this runs before the DI container exists, so it validates nothing —
// a missing or unrecognized value skips the init, and boot validation rejects the process moments
// later with the operator-facing report.
if (
    SENTRY_DSN &&
    SENTRY_ENVIRONMENT &&
    Object.values(ExceptionTrackerEnvironment).includes(SENTRY_ENVIRONMENT as ExceptionTrackerEnvironment)
) {
    Sentry.init({
        dsn: SENTRY_DSN,
        environment: SENTRY_ENVIRONMENT,
    });
}
