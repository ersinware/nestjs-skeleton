/**
 * @file logger.port.ts
 * @description Structured-only logging contract and its injection token.
 */

import type { LogPayload } from 'src/core/observability/logger/log-payload';

export const TOKEN_LOGGER_PORT = Symbol('TOKEN_LOGGER_PORT');

/**
 * Structured-only logging contract: every level takes the closed {@link LogPayload} envelope, so
 * an unstructured string can never enter the stream. Deliberately three levels — `debug` and
 * `fatal` have no caller and would only invite level drift.
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
