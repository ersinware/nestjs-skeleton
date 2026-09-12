/**
 * @file index.ts
 * @description Public API of the error-reporter concern.
 */

export { ErrorReporterModule } from 'src/core/observability/error-reporter/module';
export { TOKEN_ERROR_REPORTER_PORT } from 'src/core/observability/error-reporter/port/error-reporter.port';
export type {
    ErrorReportContext,
    IErrorReporterPort,
} from 'src/core/observability/error-reporter/port/error-reporter.port';
