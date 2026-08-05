/**
 * @file exception-tracker.port.ts
 * @description Contract for reporting exceptions to an external tracking service.
 */

export const TOKEN_EXCEPTION_TRACKER_PORT = Symbol('TOKEN_EXCEPTION_TRACKER_PORT');

/**
 * Contract for reporting an exception, used only when a human must intervene and the failure will
 * not self-heal. Pairs with the logger's `error`, never replaces it.
 */
export interface IExceptionTrackerPort {
    /**
     * Captures an exception and sends it to the configured monitoring service.
     *
     * @param exception The exception object or raw error to track.
     */
    captureException(exception: unknown): void;
}
