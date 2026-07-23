/**
 * @file port.ts
 * @description Contract for logging services injected into the application domain.
 */

import { LogPayload } from 'src/core/observability/logger/log-payload';

export const TOKEN_LOGGER_PORT = Symbol('TOKEN_LOGGER_PORT');

/**
 * Structured-only logging contract. Every level takes the closed {@link LogPayload} envelope and
 * nothing else: a free-form signature would let an unstructured string through, and a single such
 * call makes the log stream unqueryable for the field the rest of the codebase guarantees.
 * The surface is deliberately three levels — `debug` and `fatal` have no caller and would only
 * invite level drift.
 */
export interface ILoggerPort {
    /**
     * Records an operationally significant event. Emitted at pino's `info` level — `log` keeps the
     * NestJS-facing name so call sites read the same as the rest of the framework.
     */
    log(payload: LogPayload): void;

    /**
     * Records a failure that resolves itself but whose cause is worth a forensic breadcrumb.
     */
    warn(payload: LogPayload): void;

    /**
     * Records a failure a human must act on. Pairs with the exception tracker, never replaces it.
     */
    error(payload: LogPayload): void;
}
