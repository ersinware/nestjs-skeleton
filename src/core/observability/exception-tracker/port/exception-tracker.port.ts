/**
 * @file exception-tracker.port.ts
 * @description Contract for reporting exceptions to an external tracking service.
 */

export const TOKEN_EXCEPTION_TRACKER_PORT = Symbol('TOKEN_EXCEPTION_TRACKER_PORT');

/**
 * Reports exceptions that require human intervention and will not self-heal.
 */
export interface IExceptionTrackerPort {
    /**
     * Sends an exception to the tracking service.
     *
     * @param exception The exception to report.
     */
    captureException(exception: unknown): void;
}
