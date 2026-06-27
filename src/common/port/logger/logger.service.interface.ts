/**
 * @file logger.service.interface.ts
 * @description Contract for logging services injected into the application domain.
 * This abstracts third-party logger implementations (like pino) to ensure external independence.
 */

export interface ILoggerService {
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

    /**
     * Write a 'debug' level log.
     */
    debug?(message: unknown, ...optionalParams: unknown[]): void;

    /**
     * Write a 'verbose' level log.
     */
    verbose?(message: unknown, ...optionalParams: unknown[]): void;

    /**
     * Write a 'fatal' level log.
     */
    fatal?(message: unknown, ...optionalParams: unknown[]): void;
}
