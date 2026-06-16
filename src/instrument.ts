/**
 * @file instrument.ts
 * @description Sentry SDK early initialization script.
 * Crucial: This must be imported at the very top of `main.ts` before any other module loads
 * to correctly intercept and capture application exceptions.
 */

import * as Sentry from '@sentry/nestjs';
import { ENV } from './common/config/constant/env.constant';
import { SentryEnvironment } from './common/enum/config/sentry-environment.enum';

const SENTRY_DSN = process.env[ENV.SENTRY_DSN],
    SENTRY_ENVIRONMENT = process.env[ENV.SENTRY_ENVIRONMENT] as SentryEnvironment;

if (!SENTRY_DSN) {
    throw new Error('SENTRY_DSN environment variable is required.');
}

if (!SENTRY_ENVIRONMENT) {
    throw new Error('SENTRY_ENVIRONMENT environment variable is required.');
}

if (!Object.values(SentryEnvironment).includes(SENTRY_ENVIRONMENT)) {
    throw new Error(
        `Invalid SENTRY_ENVIRONMENT: "${SENTRY_ENVIRONMENT}". Must be one of: ${Object.values(SentryEnvironment).join(', ')}`,
    );
}

Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
});
