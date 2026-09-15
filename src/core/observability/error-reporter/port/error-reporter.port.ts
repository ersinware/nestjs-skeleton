/**
 * @file error-reporter.port.ts
 * @description Contract for paired operational logging and exception tracking.
 */

/**
 * Dependency injection token representing the {@link IErrorReporterPort} contract.
 */
export const TOKEN_ERROR_REPORTER_PORT = Symbol('TOKEN_ERROR_REPORTER_PORT');

/** Reporting location with optional message and structured log data. */
export type ErrorReportContext = {
    readonly class: string;
    readonly method: string;
    /** Missing or empty messages fall back to the normalized error's message. */
    readonly message?: string;
    readonly data?: Readonly<Record<string, unknown>>;
};

/** Reports failures selected by the handling boundary without classifying or rethrowing them. */
export interface IErrorReporterPort {
    /**
     * Logs the failure as an Error and sends the original caught value to exception tracking.
     *
     * @param error The original caught value
     * @param context Reporting location with optional message and structured log data
     */
    report(error: unknown, context: ErrorReportContext): void;
}
