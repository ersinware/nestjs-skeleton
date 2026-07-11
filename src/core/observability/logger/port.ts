/**
 * @file port.ts
 * @description Contract for logging services injected into the application domain.
 */

export const TOKEN_LOGGER_PORT = Symbol('TOKEN_LOGGER_PORT');

export interface ILoggerPort {
    /**
     * Write a 'log' level log.
     */
    log(message: unknown, ...optionalParams: unknown[]): void;

    /**
     * Write an 'error' level log.
     */
    error(message: unknown, ...optionalParams: unknown[]): void;

    /**
     * Write a 'warn' level log.
     */
    warn(message: unknown, ...optionalParams: unknown[]): void;
}
