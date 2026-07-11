/**
 * @file port.ts
 * @description Defines the port for tracking application exceptions and errors.
 */

/** Token for the exception tracker port */
export const TOKEN_EXCEPTION_TRACKER_PORT = Symbol('TOKEN_EXCEPTION_TRACKER_PORT');

/**
 * Interface representing the capability to capture and track exceptions.
 */
export interface IExceptionTrackerPort {
    /**
     * Captures an exception and sends it to the configured monitoring service.
     *
     * @param exception The exception object or raw error to track.
     */
    captureException(exception: unknown): void;
}
